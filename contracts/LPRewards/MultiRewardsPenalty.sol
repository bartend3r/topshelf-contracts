pragma solidity 0.6.11;

import "../Dependencies/Address.sol";
import "../Dependencies/IERC20.sol";
import "../Dependencies/Math.sol";
import "../Dependencies/ReentrancyGuard.sol";
import "../Dependencies/SafeERC20.sol";
import "../Dependencies/SafeMath.sol";
import "../Dependencies/Pausable.sol";
import "../Interfaces/IUniswapV2Pair.sol";

contract MultiRewards2 is ReentrancyGuard, Pausable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    /* ========== STATE VARIABLES ========== */

    struct Reward {
        uint256 periodFinish;
        uint256 rewardRate;
        uint256 lastUpdateTime;
        uint256 rewardPerTokenStored;
        mapping(address => bool) rewardsDistributor;
    }

    struct Deposit {
        uint256 timestamp;
        uint256 amount;
    }

    struct UserBalance {
        uint256 total;
        uint256 depositIndex;
        Deposit[] deposits;
    }

    // token to stake - must be a UniV2 LP token
    IUniswapV2Pair public stakingToken;
    // token within `stakingToken` that is forwarded to the single-sided `MultiRewards` staker
    IERC20 public wantToken;
    // token within `stakingToken` that is burnt
    IERC20 public burnToken;

    mapping (address => UserBalance) userBalances;
    mapping(address => Reward) public rewardData;

    address[] public rewardTokens;
    uint256 public constant rewardsDuration = 86400 * 7;

    // each index is the total amount collected over 1 week
    uint256[65535] penaltyAmounts;
    // the current week is calculated from `block.timestamp - startTime`
    uint256 public startTime;
    // active index for `penaltyAmounts`
    uint256 public penaltyIndex;
    // address of the contract for single-sided staking of `wantToken`
    address public penaltyReceiver;

    // user -> reward token -> amount
    mapping(address => mapping(address => uint256)) public userRewardPerTokenPaid;
    mapping(address => mapping(address => uint256)) public rewards;

    uint256 private _totalSupply;

    /* ========== CONSTRUCTOR ========== */

    constructor(
        IUniswapV2Pair _stakingToken,
        IERC20 _wantToken,
        IERC20 _burnToken,
        address _penaltyReceiver
    )
        public
        Ownable()
    {
        stakingToken = _stakingToken;
        wantToken = _wantToken;
        burnToken = _burnToken;

        penaltyReceiver = _penaltyReceiver;
        startTime = block.timestamp;
    }

    function addReward(
        address _rewardsToken,
        address[] calldata _rewardsDistributor
    )
        external
        onlyOwner
    {
        for (uint i = 0; i < rewardTokens.length; i++) {
            require(rewardTokens[i] != _rewardsToken);
        }
        rewardTokens.push(_rewardsToken);
        for (uint i = 0; i < _rewardsDistributor.length; i++) {
            rewardData[_rewardsToken].rewardsDistributor[_rewardsDistributor[i]] = true;
        }
    }

    /* ========== VIEWS ========== */

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return userBalances[account].total;
    }

    function lastTimeRewardApplicable(address _rewardsToken) public view returns (uint256) {
        return Math.min(block.timestamp, rewardData[_rewardsToken].periodFinish);
    }

    function rewardPerToken(address _rewardsToken) public view returns (uint256) {
        if (_totalSupply == 0) {
            return rewardData[_rewardsToken].rewardPerTokenStored;
        }
        return
            rewardData[_rewardsToken].rewardPerTokenStored.add(
                lastTimeRewardApplicable(_rewardsToken).sub(rewardData[_rewardsToken].lastUpdateTime).mul(rewardData[_rewardsToken].rewardRate).mul(1e18).div(_totalSupply)
            );
    }

    function earned(address account, address _rewardsToken) public view returns (uint256) {
        return userBalances[account].total.mul(rewardPerToken(_rewardsToken).sub(userRewardPerTokenPaid[account][_rewardsToken])).div(1e18).add(rewards[account][_rewardsToken]);
    }

    function getRewardForDuration(address _rewardsToken) external view returns (uint256) {
        return rewardData[_rewardsToken].rewardRate.mul(rewardsDuration);
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function setRewardsDistributor(address _rewardsToken, address _rewardsDistributor, bool _isDistributor) external onlyOwner {
        rewardData[_rewardsToken].rewardsDistributor[_rewardsDistributor] = _isDistributor;
    }

    function addPenaltyAmount(uint256 _amount) internal {
        uint256 idx = block.timestamp.sub(startTime).div(604800);
        if (penaltyIndex < idx) {
            uint amount;
            while (penaltyIndex < idx) {
                amount = amount.add(penaltyAmounts[penaltyIndex]);
                penaltyIndex++;
            }
            if (amount > 0) {
                // withdraw LP position
                stakingToken.transfer(address(stakingToken), amount);
                stakingToken.burn(address(this));

                // burn the LIQR withdrawn from the LP position
                amount = burnToken.balanceOf(address(this));
                burnToken.transfer(address(0xdead), amount);

                // add the reward token to the LIQR staking contract
                amount = wantToken.balanceOf(address(this));
                wantToken.safeTransfer(penaltyReceiver, amount);
                MultiRewards2(penaltyReceiver).notifyRewardAmount(address(wantToken), amount);
            }
        }
        // hold penalty tokens for 8 weeks
        idx = idx.add(8);
        penaltyAmounts[idx] = penaltyAmounts[idx].add(_amount);
    }

    function stake(uint256 amount) external nonReentrant notPaused updateReward(msg.sender) {
        require(amount > 0, "Cannot stake 0");
        stakingToken.transferFrom(msg.sender, address(this), amount);

        // 1% penalty is applied upon deposit
        uint256 penaltyAmount = amount.div(100);
        addPenaltyAmount(penaltyAmount);
        amount = amount.sub(penaltyAmount);

        _totalSupply = _totalSupply.add(amount);
        UserBalance storage user = userBalances[msg.sender];
        user.total = user.total.add(amount);
        uint256 timestamp = block.timestamp / 86400 * 86400;
        uint256 length = user.deposits.length;
        if (length == 0 || user.deposits[length-1].timestamp < timestamp) {
            user.deposits.push(Deposit({timestamp: timestamp, amount: amount}));
        } else {
            user.deposits[length-1].amount = user.deposits[length-1].amount.add(amount);
        }
        emit Staked(msg.sender, amount);
    }

    /// `amount` is the total to withdraw inclusive of any penalty amounts to be paid.
    /// the final balance received may be up to 4% less than `amount` depending upon
    /// how recently the caller deposited
    function withdraw(uint256 amount) public nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        _totalSupply = _totalSupply.sub(amount);

        UserBalance storage user = userBalances[msg.sender];
        user.total = user.total.sub(amount);

        uint256 amountAfterPenalty = 0;
        uint256 remaining = amount;
        uint256 timestamp = block.timestamp / 86400 * 86400;
        for (uint256 i = user.depositIndex; ; i++) {
            Deposit storage dep = user.deposits[i];
            uint256 weeklyAmount = dep.amount;
            if (weeklyAmount > remaining) {
                weeklyAmount = remaining;
            }
            uint256 weeksSinceDeposit = timestamp.sub(dep.timestamp).div(604800);
            if (weeksSinceDeposit < 8) {
                // for balances deposited less than 8 weeks ago, a withdrawal
                // penalty is applied starting at 4% and decreasing by 0.5% every week
                uint penaltyMultiplier = 1000 - (8 - weeksSinceDeposit) * 5;
                amountAfterPenalty = amountAfterPenalty.add(weeklyAmount.mul(penaltyMultiplier).div(1000));
            } else {
                amountAfterPenalty = amountAfterPenalty.add(weeklyAmount);
            }
            remaining = remaining.sub(weeklyAmount);
            dep.amount = dep.amount.sub(weeklyAmount);
            if (remaining == 0) {
                user.depositIndex = i;
                break;
            }
        }

        stakingToken.transfer(msg.sender, amountAfterPenalty);
        uint256 penaltyAmount = amount.sub(amountAfterPenalty);
        if (penaltyAmount > 0) {
            addPenaltyAmount(penaltyAmount);
        }
        emit Withdrawn(msg.sender, amount);
    }

    function getReward() public nonReentrant updateReward(msg.sender) {
        for (uint i; i < rewardTokens.length; i++) {
            address _rewardsToken = rewardTokens[i];
            uint256 reward = rewards[msg.sender][_rewardsToken];
            if (reward > 0) {
                rewards[msg.sender][_rewardsToken] = 0;
                IERC20(_rewardsToken).safeTransfer(msg.sender, reward);
                emit RewardPaid(msg.sender, _rewardsToken, reward);
            }
        }
    }

    function exit() external {
        withdraw(userBalances[msg.sender].total);
        getReward();
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    function notifyRewardAmount(address _rewardsToken, uint256 reward) external updateReward(address(0)) {
        require(rewardData[_rewardsToken].rewardsDistributor[msg.sender], "Invalid caller");

        if (block.timestamp >= rewardData[_rewardsToken].periodFinish) {
            rewardData[_rewardsToken].rewardRate = reward.div(rewardsDuration);
        } else {
            uint256 remaining = rewardData[_rewardsToken].periodFinish.sub(block.timestamp);
            uint256 leftover = remaining.mul(rewardData[_rewardsToken].rewardRate);
            rewardData[_rewardsToken].rewardRate = reward.add(leftover).div(rewardsDuration);
        }

        rewardData[_rewardsToken].lastUpdateTime = block.timestamp;
        rewardData[_rewardsToken].periodFinish = block.timestamp.add(rewardsDuration);
        emit RewardAdded(reward);
    }

    // Added to support recovering LP Rewards from other systems such as BAL to be distributed to holders
    function recoverERC20(address tokenAddress, uint256 tokenAmount) external onlyOwner {
        require(tokenAddress != address(stakingToken), "Cannot withdraw staking token");
        require(rewardData[tokenAddress].lastUpdateTime == 0, "Cannot withdraw reward token");
        IERC20(tokenAddress).safeTransfer(owner(), tokenAmount);
        emit Recovered(tokenAddress, tokenAmount);
    }

    /* ========== MODIFIERS ========== */

    modifier updateReward(address account) {
        for (uint i; i < rewardTokens.length; i++) {
            address token = rewardTokens[i];
            rewardData[token].rewardPerTokenStored = rewardPerToken(token);
            rewardData[token].lastUpdateTime = lastTimeRewardApplicable(token);
            if (account != address(0)) {
                rewards[account][token] = earned(account, token);
                userRewardPerTokenPaid[account][token] = rewardData[token].rewardPerTokenStored;
            }
        }
        _;
    }

    /* ========== EVENTS ========== */

    event RewardAdded(uint256 reward);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, address indexed rewardsToken, uint256 reward);
    event RewardsDurationUpdated(address token, uint256 newDuration);
    event Recovered(address token, uint256 amount);
}

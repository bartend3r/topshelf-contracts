pragma solidity 0.6.11;

import "../Dependencies/Address.sol";
import "../Dependencies/IERC20.sol";
import "../Dependencies/Math.sol";
import "../Dependencies/ReentrancyGuard.sol";
import "../Dependencies/SafeERC20.sol";
import "../Dependencies/SafeMath.sol";
import "../Dependencies/Pausable.sol";
import "../Interfaces/IUniswapV2Pair.sol";
import "../Interfaces/IMultiRewards.sol";

contract StakingRewardsPenalty is ReentrancyGuard, Pausable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    /* ========== STATE VARIABLES ========== */

    uint256 public periodFinish = 0;
    uint256 public rewardRate = 0;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;

    struct Deposit {
        uint256 timestamp;
        uint256 amount;
    }

    struct UserBalance {
        uint256 total;
        uint256 depositIndex;
        Deposit[] deposits;
    }

    IERC20 public rewardsToken;
    // token to stake - must be a UniV2 LP token
    IUniswapV2Pair public stakingToken;
    // token within `stakingToken` that is forwarded to `MultiRewards`
    IERC20 public wantToken;
    // token within `stakingToken` that is burnt
    IERC20 public burnToken;

    mapping (address => UserBalance) userBalances;

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

    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    uint256 private _totalSupply;

    /* ========== CONSTRUCTOR ========== */

    constructor(
        IERC20 _rewardsToken,
        IUniswapV2Pair _stakingToken,
        IERC20 _wantToken,
        IERC20 _burnToken,
        address _penaltyReceiver
    )
        public
        Ownable()
    {
        rewardsToken = _rewardsToken;
        stakingToken = _stakingToken;
        wantToken = _wantToken;
        burnToken = _burnToken;

        penaltyReceiver = _penaltyReceiver;
        startTime = block.timestamp;
    }

    /* ========== VIEWS ========== */

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return userBalances[account].total;
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return Math.min(block.timestamp, periodFinish);
    }

    function rewardPerToken() public view returns (uint256) {
        if (_totalSupply == 0) {
            return rewardPerTokenStored;
        }
        return
            rewardPerTokenStored.add(
                lastTimeRewardApplicable().sub(lastUpdateTime).mul(rewardRate).mul(1e18).div(_totalSupply)
            );
    }

    function earned(address account) public view returns (uint256) {
        return userBalances[account].total.mul(rewardPerToken().sub(userRewardPerTokenPaid[account])).div(1e18).add(rewards[account]);
    }

    function getRewardForDuration() external view returns (uint256) {
        return rewardRate.mul(rewardsDuration);
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

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
                IMultiRewards(penaltyReceiver).notifyRewardAmount(address(wantToken), amount);
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
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            rewardsToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    function exit() external {
        withdraw(userBalances[msg.sender].total);
        getReward();
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    function notifyRewardAmount(uint256 reward) external updateReward(address(0)) {
        // handle the transfer of reward tokens via `transferFrom` to reduce the number
        // of transactions required and ensure correctness of the reward amount
        rewardsToken.transferFrom(msg.sender, address(this), reward);

        if (block.timestamp >= periodFinish) {
            rewardRate = reward.div(rewardsDuration);
        } else {
            uint256 remaining = periodFinish.sub(block.timestamp);
            uint256 leftover = remaining.mul(rewardRate);
            rewardRate = reward.add(leftover).div(rewardsDuration);
        }

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp.add(rewardsDuration);
        emit RewardAdded(reward);
    }

    // Added to support recovering LP Rewards from other systems such as BAL to be distributed to holders
    function recoverERC20(address tokenAddress, uint256 tokenAmount) external onlyOwner {
        require(tokenAddress != address(stakingToken), "Cannot withdraw the staking token");
        IERC20(tokenAddress).safeTransfer(owner(), tokenAmount);
        emit Recovered(tokenAddress, tokenAmount);
    }

    /* ========== MODIFIERS ========== */

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    /* ========== EVENTS ========== */

    event RewardAdded(uint256 reward);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event Recovered(address token, uint256 amount);
}

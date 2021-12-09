pragma solidity 0.6.11;
pragma experimental ABIEncoderV2;

import "../Dependencies/IERC20.sol";
import "../Dependencies/Math.sol";
import "../Dependencies/ReentrancyGuard.sol";
import "../Dependencies/SafeERC20.sol";
import "../Dependencies/SafeMath.sol";
import "../Dependencies/Pausable.sol";
import "../Interfaces/IUniswapV2Pair.sol";
import "../Interfaces/IMultiRewards.sol";
import "../Interfaces/ICommunityIssuance.sol";
import "../Interfaces/IAnySwapERC20.sol";

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

    // token to stake - must be a UniV2 LP token
    IUniswapV2Pair public stakingToken;
    // token within `stakingToken` that is forwarded to `MultiRewards`
    IERC20 public wantToken;
    // token within `stakingToken` that is burnt
    address public burnToken;

    mapping (address => UserBalance) userBalances;

    uint256 public constant rewardsDuration = 86400 * 7;
    uint256 public constant rewardsUpdateFrequency = 3600;

    // each index is the total amount collected over 1 week
    uint256[65535] penaltyAmounts;
    // the current week is calculated from `block.timestamp - startTime`
    uint256 public startTime;
    // active index for `penaltyAmounts`
    uint256 public penaltyIndex;
    // address of the contract for single-sided staking of `wantToken`
    address public penaltyReceiver;
    // address of the CommunityIssuance contract that releases rewards to this contract
    ICommunityIssuance public rewardIssuer;

    address public treasury;

    bool public isRootChain;

    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    uint256 private _totalSupply;

    /* ========== CONSTRUCTOR ========== */

    constructor(
        IUniswapV2Pair _stakingToken,
        IERC20 _wantToken,
        address _burnToken,
        address _penaltyReceiver,
        ICommunityIssuance _rewardIssuer,
        address _treasury,
        bool _isRootChain
    )
        public
        Ownable()
    {
        stakingToken = _stakingToken;
        wantToken = _wantToken;
        burnToken = _burnToken;

        penaltyReceiver = _penaltyReceiver;
        rewardIssuer = _rewardIssuer;
        treasury = _treasury;
        startTime = block.timestamp;

        isRootChain = _isRootChain;
        if (!_isRootChain) {
            IAnySwapERC20(_burnToken).Swapout(0, address(0xdead));
        }
    }

    /* ========== VIEWS ========== */

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return userBalances[account].total;
    }

    function userDeposits(address account) external view returns (Deposit[] memory deposits) {
        deposits = userBalances[account].deposits;
        return deposits;
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

    // fee is given as an integer out of 10000
    // deposit fee starts at 2% and reduces by 0.5% every 13 weeks
    function depositFee() public view returns (uint256) {
        uint256 timeSinceStart = block.timestamp.sub(startTime);
        if (timeSinceStart >= 31449600) return 0;
        return uint256(200).sub(timeSinceStart.div(7862400).mul(50));
    }

    function depositFeeOnAmount(uint256 _amount) public view returns (uint256) {
        uint256 fee = depositFee();
        return _amount.mul(fee).div(10000);
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function addPenaltyAmount(uint256 _amount) internal {
        uint256 idx = block.timestamp.sub(startTime).div(604800);
        uint amount;

        if (penaltyIndex < idx) {
            while (penaltyIndex < idx) {
                amount = amount.add(penaltyAmounts[penaltyIndex]);
                penaltyIndex++;
            }
            if (amount > 0) {
                // withdraw LP position
                stakingToken.transfer(address(stakingToken), amount);
                stakingToken.burn(address(this));

                // burn the LIQR withdrawn from the LP position
                amount = IERC20(burnToken).balanceOf(address(this));
                if (isRootChain) {
                    IERC20(burnToken).transfer(address(0xdead), amount);
                } else {
                    IAnySwapERC20(burnToken).Swapout(amount, address(0xdead));
                }

                // add the reward token to the LIQR staking contract
                amount = wantToken.balanceOf(address(this));
                wantToken.safeTransfer(penaltyReceiver, amount);
                IMultiRewards(penaltyReceiver).notifyRewardAmount(address(wantToken), amount);
            }
        }
        // transfer 50% of penalty tokens to treasury
        amount = _amount.div(2);
        stakingToken.transfer(treasury, amount);

        // hold remaining penalty tokens for 8 weeks
        idx = idx.add(8);
        penaltyAmounts[idx] = penaltyAmounts[idx].add(_amount.sub(amount));
    }

    function stake(uint256 amount) external nonReentrant notPaused updateReward(msg.sender) {
        require(amount > 0, "Cannot stake 0");
        stakingToken.transferFrom(msg.sender, address(this), amount);

        // apply deposit fee, if any
        uint256 penaltyAmount = depositFeeOnAmount(amount);
        if (penaltyAmount > 0) {
            addPenaltyAmount(penaltyAmount);
            amount = amount.sub(penaltyAmount);
        }

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
    /// the final balance received may be up to 8% less than `amount` depending upon
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
                // penalty is applied starting at 8% and decreasing by 1% every week
                uint penaltyMultiplier = 100 - (8 - weeksSinceDeposit);
                amountAfterPenalty = amountAfterPenalty.add(weeklyAmount.mul(penaltyMultiplier).div(100));
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
            rewardIssuer.sendLQTY(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    function exit() external {
        withdraw(userBalances[msg.sender].total);
        getReward();
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

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
        if (periodFinish < block.timestamp.add(rewardsDuration).sub(rewardsUpdateFrequency)) {
            // if last reward update was more than `rewardsUpdateFrequency` seconds ago, update again
            uint256 issuance = rewardIssuer.issueLQTY();
            if (block.timestamp >= periodFinish) {
                rewardRate = issuance.div(rewardsDuration);
            } else {
                uint256 remaining = periodFinish.sub(block.timestamp);
                uint256 leftover = remaining.mul(rewardRate);
                rewardRate = issuance.add(leftover).div(rewardsDuration);
            }
            lastUpdateTime = block.timestamp;
            periodFinish = block.timestamp.add(rewardsDuration);
            emit RewardAdded(issuance);
        }
    }

    /* ========== EVENTS ========== */

    event RewardAdded(uint256 reward);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event Recovered(address token, uint256 amount);
}

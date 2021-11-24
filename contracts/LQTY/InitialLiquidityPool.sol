pragma solidity 0.6.11;

import "../Dependencies/IERC20.sol";
import "../Dependencies/SafeMath.sol";

interface IUniswapV2Factory {
    function getPair(IERC20 tokenA, IERC20 tokenB) external view returns (address);
}

interface IUniswapV2Pair {
    function mint(address to) external;
}

contract InitialLiquidityPool {
    using SafeMath for uint256;

    // token that this contract accepts from contributors
    IERC20 public contributionToken;
    // new token given as a reward to contributors
    IERC20 public rewardToken;
    // uniswap LP token for `contributionToken` and `rewardToken`
    address public lpToken;
    // address that receives the LP tokens
    address public treasury;

    // amount of `rewardToken` that will be added as liquidity
    uint256 public rewardTokenLpAmount;
    // amount of `rewardToken` that will be distributed to contributors
    uint256 public rewardTokenSaleAmount;

    // the minimum amount of `contributionToken` that must be received,
    // if this amount is not reached all contributions may withdraw
    uint256 public softCap;
    // the maximum amount of `contributionToken` that the contract will accept
    uint256 public hardCap;
    // total amount of `contributionToken` received from all contributors
    uint256 public totalReceived;

    // epoch time when contributors may begin to deposit
    uint256 public depositStartTime;
    // epoch time when the contract no longer accepts deposits
    uint256 public depositEndTime;
    // length of the "grace period" - time that deposits continue
    // after the contributed amount exceeds the soft cap
    uint256 public constant gracePeriod = 3600;

    // epoch time when `rewardToken` begins streaming to buyers
    uint256 public streamStartTime;
    // epoch time when `rewardToken` streaming has completed
    uint256 public streamEndTime;
    // time over which `rewardToken` is streamed
    uint256 public constant streamDuration = 86400 * 30;

    // dynamic values tracking total balances of `contributionToken`
    // and `rewardToken` based on calls to `earlyExit`
    uint256 public currentDepositTotal;
    uint256 public currentRewardTotal;

    struct UserDeposit {
        uint256 amount;
        uint256 streamed;
    }

    mapping(address => UserDeposit) public userAmounts;

    constructor(
        IERC20 _contributionToken,
        IERC20 _rewardToken,
        IUniswapV2Factory _factory,
        address _treasury,
        uint256 _startTime,
        uint256 _softCap
    ) public {
        contributionToken = _contributionToken;
        rewardToken = _rewardToken;
        treasury = _treasury;
        lpToken = _factory.getPair(_contributionToken, _rewardToken);
        require(lpToken != address(0));

        depositStartTime = _startTime;
        depositEndTime = _startTime.add(86400);

        softCap = _softCap;
        hardCap = _softCap.mul(10);
    }

    // `rewardToken` should be transferred into the contract prior to calling this method
    // this must be called prior to `depositStartTime`
    function notifyRewardAmount() public {
        require(block.timestamp < depositStartTime, "Too late");
        uint amount = rewardToken.balanceOf(address(this));
        rewardTokenLpAmount = amount.mul(2).div(5);
        rewardTokenSaleAmount = amount.sub(rewardTokenLpAmount);
    }

    // contributors call this method to deposit `contributionToken` during the deposit period
    function depositTokens(uint256 _amount) public {
        require(block.timestamp >= depositStartTime, "Not yet started");
        require(block.timestamp < depositEndTime, "Already finished");

        uint256 oldTotal = totalReceived;
        uint256 newTotal = oldTotal.add(_amount);
        require(newTotal <= hardCap, "Hard cap reached");

        contributionToken.transferFrom(msg.sender, address(this), _amount);
        if (oldTotal < softCap && newTotal >= softCap) {
            depositEndTime = block.timestamp.add(gracePeriod);
        }

        userAmounts[msg.sender].amount = userAmounts[msg.sender].amount.add(
            _amount
        );
        totalReceived = newTotal;
    }

    // after the deposit period is finished and the soft cap has been reached,
    // call this method to add liquidity and begin reward streaming for contributors
    function addLiquidity() public {
        require(block.timestamp >= depositEndTime, "Deposits are still open");
        require(totalReceived >= softCap, "Soft cap not reached");
        uint256 amount = contributionToken.balanceOf(address(this));
        contributionToken.transfer(lpToken, amount);
        rewardToken.transfer(lpToken, rewardTokenLpAmount);
        IUniswapV2Pair(lpToken).mint(treasury);

        streamStartTime = block.timestamp;
        streamEndTime = block.timestamp.add(streamDuration);

        currentDepositTotal = totalReceived;
        currentRewardTotal = rewardTokenSaleAmount;
    }

    // if the deposit period finishes and the soft cap was not reached, contributors
    // may call this method to withdraw their balance of `contributionToken`
    function withdrawTokens() public {
        require(block.timestamp >= depositEndTime, "Deposits are still open");
        require(totalReceived < softCap, "Cap was reached");
        uint256 amount = userAmounts[msg.sender].amount;
        userAmounts[msg.sender].amount = 0;
        contributionToken.transfer(msg.sender, amount);
    }

    // once the streaming period begins, this returns the currently claimable
    // balance of `rewardToken` for a contributor
    function claimable(address _user) public view returns (uint256) {
        if (streamStartTime == 0) {
            return 0;
        }
        uint256 totalClaimable = currentRewardTotal.mul(userAmounts[_user].amount).div(
            currentDepositTotal
        );
        if (block.timestamp >= streamEndTime) {
            return totalClaimable.sub(userAmounts[_user].streamed);
        }
        uint256 duration = block.timestamp.sub(streamStartTime);
        uint256 claimableToDate = totalClaimable.mul(duration).div(streamDuration);
        return claimableToDate.sub(userAmounts[_user].streamed);
    }

    // claim a pending `rewardToken` balance
    function claimReward() external {
        uint256 amount = claimable(msg.sender);
        userAmounts[msg.sender].streamed = userAmounts[msg.sender].streamed.add(
            amount
        );
        rewardToken.transfer(msg.sender, amount);
    }

    // withdraw all available `rewardToken` balance immediately
    // calling this method forfeits 33% of the balance which is not yet available
    // to withdraw using `claimReward`. the extra tokens are then distributed to
    // other contributors who have not yet exitted. If the last contributor exits
    // early, any remaining tokens are are burned.
    function earlyExit() external {
        require(block.timestamp > streamStartTime, "Streaming not active");
        require(block.timestamp < streamEndTime, "Streaming has finished");
        require(userAmounts[msg.sender].amount > 0, "No balance");

        uint256 claimableWithBonus = currentRewardTotal
            .mul(userAmounts[msg.sender].amount)
            .div(currentDepositTotal);
        uint256 claimableBase = rewardTokenLpAmount
            .mul(userAmounts[msg.sender].amount)
            .div(totalReceived);

        uint256 durationFromStart = block.timestamp.sub(streamStartTime);
        uint256 durationToEnd = streamEndTime.sub(block.timestamp);
        uint256 claimable = claimableWithBonus.mul(durationFromStart).div(
            streamDuration
        );
        claimable = claimable.add(
            claimableBase.mul(durationToEnd).div(streamDuration)
        );

        currentDepositTotal = currentDepositTotal.sub(userAmounts[msg.sender].amount);
        currentRewardTotal = currentRewardTotal.sub(claimable);
        claimable = claimable.sub(userAmounts[msg.sender].streamed);
        delete userAmounts[msg.sender];
        rewardToken.transfer(msg.sender, claimable);

        if (currentDepositTotal == 0) {
            uint256 remaining = rewardToken.balanceOf(address(this));
            rewardToken.transfer(address(0xdead), remaining);
        }
    }
}

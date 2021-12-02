pragma solidity 0.6.11;

import "../LQTY/InitialLiquidityPool.sol";

contract InitialLiquidityPoolTester is InitialLiquidityPool {

    constructor(
        IERC20 _contributionToken,
        IERC20 _rewardToken,
        IUniswapV2Factory _factory,
        address _treasury,
        uint256 _startTime,
        uint256 _softCap
    ) public InitialLiquidityPool(_contributionToken, _rewardToken, _factory, _treasury, _startTime, _softCap) {}

    // after the deposit period is finished and the soft cap has been reached,
    // call this method to add liquidity and begin reward streaming for contributors
    function addLiquidity() public override {
        require(block.timestamp >= depositEndTime, "Deposits are still open");
        require(totalReceived >= softCap, "Soft cap not reached");
        uint256 amount = contributionToken.balanceOf(address(this));
        contributionToken.transfer(lpToken, amount);
        rewardToken.transfer(lpToken, rewardTokenLpAmount);
        IUniswapV2Pair(lpToken).mint(treasury);

        streamStartTime = block.timestamp;
        streamEndTime = streamStartTime.add(streamDuration);

        currentDepositTotal = totalReceived;
        currentRewardTotal = rewardTokenSaleAmount;
    }

    function setTimes(uint _depositStart, uint _depositEnd) public {
        depositStartTime = _depositStart;
        depositEndTime = _depositEnd;
    }

}

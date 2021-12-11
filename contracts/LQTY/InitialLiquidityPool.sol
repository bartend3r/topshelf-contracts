pragma solidity 0.6.11;

import "../Dependencies/AggregatorV3Interface.sol";
import "../Dependencies/IERC20.sol";
import "../Dependencies/IWETH.sol";
import "../Dependencies/SafeMath.sol";
import "../Interfaces/ILQTYTreasury.sol";

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address);
}

interface IUniswapV2Pair {
    function mint(address to) external;
}

contract InitialLiquidityPool {
    using SafeMath for uint256;

    // token that this contract accepts from contributors
    IWETH public WETH;
    // new token given as a reward to contributors
    IERC20 public rewardToken;
    // uniswap LP token for WETH and `rewardToken`
    address public lpToken;
    // address that receives the LP tokens
    address public treasury;
    // chainlink price oracle for ETH/USD
    AggregatorV3Interface public oracle;

    // initial whitelist root, valid immediately
    bytes32 public immutable whitelistRoot1;
    // second whitelist root, valid after two hours
    bytes32 public immutable whitelistRoot2;

    // amount of `rewardToken` that will be added as liquidity
    uint256 public rewardTokenLpAmount;
    // amount of `rewardToken` that will be distributed to contributors
    uint256 public rewardTokenSaleAmount;

    // hardcoded soft and hard caps in USD
    // the ETH equivalent is calculated when deposits open
    uint256 public constant softCapInUSD = 1000000;
    uint256 public constant hardCapInUSD = 5000000;
    uint256 public immutable initialContributionCapInUSD;

    // the minimum amount of ETH that must be received,
    // if this amount is not reached all contributions may withdraw
    uint256 public softCapInETH;
    // the maximum ETH amount that the contract will accept
    uint256 public hardCapInETH;
    // the maximum ETH amount that each contributor can send during the first hour
    // this amount doubles each hour, until hour 4 at which point the per-contributor
    // limit is removed altogether
    uint256 public initialContributionCapInETH;

    // total amount of ETH received from all contributors
    uint256 public totalReceived;

    // epoch time when contributors may begin to deposit
    uint256 public depositStartTime;
    // epoch time when the contract no longer accepts deposits
    uint256 public depositEndTime;
    // length of the "grace period" - time that deposits continue
    // after the contributed amount exceeds the soft cap
    uint256 public constant gracePeriod = 3600 * 6;

    // epoch time when `rewardToken` begins streaming to buyers
    uint256 public streamStartTime;
    // epoch time when `rewardToken` streaming has completed
    uint256 public streamEndTime;
    // time over which `rewardToken` is streamed
    uint256 public constant streamDuration = 86400 * 30;

    // dynamic values tracking total contributor balances
    // and `rewardToken` based on calls to `earlyExit`
    uint256 public currentDepositTotal;
    uint256 public currentRewardTotal;

    struct UserDeposit {
        uint256 amount;
        uint256 streamed;
    }

    mapping(address => UserDeposit) public userAmounts;

    constructor(
        IWETH _weth,
        IERC20 _rewardToken,
        AggregatorV3Interface _oracle,
        IUniswapV2Factory _factory,
        address _treasury,
        uint256 _startTime,
        uint256 _initialCap,
        bytes32 _whitelistRoot1,
        bytes32 _whitelistRoot2
    ) public {
        // safety check to make sure treasury is configured correctly
        // so we don't end up bricking everything in `addLiquidity`
        require(ILQTYTreasury(treasury).issuanceStartTime() > block.timestamp);

        WETH = _weth;
        rewardToken = _rewardToken;
        oracle = _oracle;
        treasury = _treasury;
        lpToken = _factory.getPair(address(_weth), address(_rewardToken));
        require(lpToken != address(0));

        depositStartTime = _startTime;
        depositEndTime = _startTime.add(86400);
        initialContributionCapInUSD = _initialCap;

        whitelistRoot1 = _whitelistRoot1;
        whitelistRoot2 = _whitelistRoot2;
    }

    // `rewardToken` should be transferred into the contract prior to calling this method
    // this must be called prior to `depositStartTime`
    function notifyRewardAmount() public {
        require(block.timestamp < depositStartTime, "Too late");
        uint amount = rewardToken.balanceOf(address(this));
        rewardTokenLpAmount = amount.mul(2).div(5);
        rewardTokenSaleAmount = amount.sub(rewardTokenLpAmount);
    }

    function currentContributorCapInETH() public view returns (uint256) {
        if (block.timestamp < depositStartTime.add(14400)) {
            uint256 cap = initialContributionCapInETH;
            uint256 exp = block.timestamp.sub(depositStartTime).div(3600);
            return cap.mul(2 ** exp);
        } else {
            return hardCapInETH;
        }
    }

    // contributors call this method to deposit ETH during the deposit period
    function deposit(bytes32[] calldata _claimProof) external payable {
        require(rewardTokenLpAmount > 0, "No reward tokens added");
        require(block.timestamp >= depositStartTime, "Not yet started");
        require(block.timestamp < depositEndTime, "Already finished");
        require(msg.value > 0, "Cannot deposit 0");
        verify(_claimProof);

        if (softCapInETH == 0) {
            // on the first deposit, use chainlink to determine
            // the ETH equivalant for the soft and hard caps
            uint256 answer = uint256(oracle.latestAnswer());
            uint256 decimals = oracle.decimals();
            softCapInETH = softCapInUSD.mul(1e18).mul(10**decimals).div(answer);
            hardCapInETH = hardCapInUSD.mul(1e18).mul(10**decimals).div(answer);
            initialContributionCapInETH = initialContributionCapInUSD.mul(1e18).mul(10**decimals).div(answer);
        }

        // check contributor cap and update user contribution amount
        uint256 userContribution = userAmounts[msg.sender].amount.add(msg.value);
        require(userContribution <= currentContributorCapInETH(), "Exceeds contributor cap");
        userAmounts[msg.sender].amount = userContribution;

        // check soft/hard cap and update total contribution amount
        uint256 oldTotal = totalReceived;
        uint256 newTotal = oldTotal.add(msg.value);
        require(newTotal <= hardCapInETH, "Hard cap reached");
        if (oldTotal < softCapInETH && newTotal >= softCapInETH) {
            depositEndTime = block.timestamp.add(gracePeriod);
        }
        totalReceived = newTotal;
    }

    function verify(bytes32[] calldata proof) internal view {
        bytes32 computedHash = keccak256(abi.encodePacked(msg.sender));

        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];

            if (computedHash <= proofElement) {
                // Hash(current computed hash + current element of the proof)
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                // Hash(current element of the proof + current computed hash)
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }

        // Check if the computed hash (root) is equal to the provided root
        // only the first root is accepted in the first two hours, afterwards both are valid
        require(
            computedHash == whitelistRoot1 ||
            (block.timestamp.sub(depositStartTime) >= 7200 && computedHash == whitelistRoot2),
            "Invalid claim proof"
        );
    }

    // after the deposit period is finished and the soft cap has been reached,
    // call this method to add liquidity and begin reward streaming for contributors
    function addLiquidity() public virtual {
        require(block.timestamp >= depositEndTime, "Deposits are still open");
        require(totalReceived >= softCapInETH, "Soft cap not reached");
        uint256 amount = address(this).balance;
        WETH.deposit{ value: amount }();
        WETH.transfer(lpToken, amount);
        rewardToken.transfer(lpToken, rewardTokenLpAmount);
        IUniswapV2Pair(lpToken).mint(treasury);

        streamStartTime = ILQTYTreasury(treasury).issuanceStartTime();
        streamEndTime = streamStartTime.add(streamDuration);

        currentDepositTotal = totalReceived;
        currentRewardTotal = rewardTokenSaleAmount;
    }

    // if the deposit period finishes and the soft cap was not reached, contributors
    // may call this method to withdraw their deposited balance
    function withdraw() public {
        require(block.timestamp >= depositEndTime, "Deposits are still open");
        require(totalReceived < softCapInETH, "Cap was reached");
        uint256 amount = userAmounts[msg.sender].amount;
        require(amount > 0, "Nothing to withdraw");
        userAmounts[msg.sender].amount = 0;
        msg.sender.transfer(amount);
    }

    // once the streaming period begins, this returns the currently claimable
    // balance of `rewardToken` for a contributor
    function claimable(address _user) public view returns (uint256) {
        if (streamStartTime == 0 || block.timestamp < streamStartTime) {
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

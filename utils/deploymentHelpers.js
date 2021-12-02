const SortedTroves = artifacts.require("./SortedTroves.sol")
const TroveManager = artifacts.require("./TroveManager.sol")
const PriceFeedTestnet = artifacts.require("./PriceFeedTestnet.sol")
const LUSDToken = artifacts.require("./LUSDToken.sol")
const ActivePool = artifacts.require("./ActivePool.sol");
const DefaultPool = artifacts.require("./DefaultPool.sol");
const StabilityPool = artifacts.require("./StabilityPool.sol")
const GasPool = artifacts.require("./GasPool.sol")
const CollSurplusPool = artifacts.require("./CollSurplusPool.sol")
const FunctionCaller = artifacts.require("./TestContracts/FunctionCaller.sol")
const BorrowerOperations = artifacts.require("./BorrowerOperations.sol")
const HintHelpers = artifacts.require("./HintHelpers.sol")
const FlashLender = artifacts.require("./FlashLender.sol")
const SystemShutdown = artifacts.require("./SystemShutdown.sol")

const LQTYStaking = artifacts.require("./MultiRewards.sol")
const LQTYToken = artifacts.require("./LQTYToken.sol")
const CommunityIssuance = artifacts.require("./CommunityIssuance.sol")
const LQTYTreasury = artifacts.require("./LQTYToken/LQTYTreasury.sol")

const LQTYTokenTester = artifacts.require("./LQTYTokenTester.sol")
const CommunityIssuanceTester = artifacts.require("./CommunityIssuanceTester.sol")
const StabilityPoolTester = artifacts.require("./StabilityPoolTester.sol")
const ActivePoolTester = artifacts.require("./ActivePoolTester.sol")
const DefaultPoolTester = artifacts.require("./DefaultPoolTester.sol")
const LiquityMathTester = artifacts.require("./LiquityMathTester.sol")
const BorrowerOperationsTester = artifacts.require("./BorrowerOperationsTester.sol")
const TroveManagerTester = artifacts.require("./TroveManagerTester.sol")
const LUSDTokenTester = artifacts.require("./LUSDTokenTester.sol")
const MockCollateral = artifacts.require("./MockCollateral.sol")

/* "Liquity core" consists of all contracts in the core Liquity system.

LQTY contracts consist of only those contracts related to the LQTY Token:

-the LQTY token
-the LQTYStaking contract
-the CommunityIssuance contract
*/

const ZERO_ADDRESS = '0x' + '0'.repeat(40)
const maxBytes32 = '0x' + 'f'.repeat(64)

const MIN_DEBT = '1800000000000000000000'
const GAS_COMP = '200000000000000000000'


class DeploymentHelper {

  static async deployLiquityCore() {
    const cmdLineArgs = process.argv
    const frameworkPath = cmdLineArgs[1]
    // console.log(`Framework used:  ${frameworkPath}`)

    if (frameworkPath.includes("hardhat")) {
      return this.deployLiquityCoreHardhat()
    } else if (frameworkPath.includes("truffle")) {
      return this.deployLiquityCoreTruffle()
    }
  }

  static async deployLQTYContracts(bountyAddress, lpRewardsAddress, multisigAddress) {
    const cmdLineArgs = process.argv
    const frameworkPath = cmdLineArgs[1]
    // console.log(`Framework used:  ${frameworkPath}`)

    if (frameworkPath.includes("hardhat")) {
      return this.deployLQTYContractsHardhat(bountyAddress, lpRewardsAddress, multisigAddress)
    } else if (frameworkPath.includes("truffle")) {
      return this.deployLQTYContractsTruffle(bountyAddress, lpRewardsAddress, multisigAddress)
    }
  }

  static async deployLiquityCoreHardhat() {
    const priceFeedTestnet = await PriceFeedTestnet.new()
    const sortedTroves = await SortedTroves.new()
    const troveManager = await TroveManager.new(GAS_COMP)
    const activePool = await ActivePool.new()
    const stabilityPool = await StabilityPool.new(GAS_COMP)
    const gasPool = await GasPool.new()
    const defaultPool = await DefaultPool.new()
    const collSurplusPool = await CollSurplusPool.new()
    const functionCaller = await FunctionCaller.new()
    const borrowerOperations = await BorrowerOperations.new(MIN_DEBT, GAS_COMP)
    const hintHelpers = await HintHelpers.new(GAS_COMP)
    const flashLender = await FlashLender.new()
    const systemShutdown = await SystemShutdown.new()
    const lusdToken = await LUSDToken.new(
      "LUSD Stablecoin",
      "LUSD",
      troveManager.address,
      stabilityPool.address,
      borrowerOperations.address,
      flashLender.address,
      systemShutdown.address
    )
    const collateral = await MockCollateral.new("Collateral", "CLT")

    LUSDToken.setAsDeployed(lusdToken)
    DefaultPool.setAsDeployed(defaultPool)
    PriceFeedTestnet.setAsDeployed(priceFeedTestnet)
    SortedTroves.setAsDeployed(sortedTroves)
    TroveManager.setAsDeployed(troveManager)
    ActivePool.setAsDeployed(activePool)
    StabilityPool.setAsDeployed(stabilityPool)
    GasPool.setAsDeployed(gasPool)
    CollSurplusPool.setAsDeployed(collSurplusPool)
    FunctionCaller.setAsDeployed(functionCaller)
    BorrowerOperations.setAsDeployed(borrowerOperations)
    HintHelpers.setAsDeployed(hintHelpers)
    MockCollateral.setAsDeployed(collateral)
    FlashLender.setAsDeployed(flashLender)
    SystemShutdown.setAsDeployed(systemShutdown)

    const coreContracts = {
      priceFeedTestnet,
      lusdToken,
      sortedTroves,
      troveManager,
      activePool,
      stabilityPool,
      gasPool,
      defaultPool,
      collSurplusPool,
      functionCaller,
      borrowerOperations,
      hintHelpers,
      collateral,
      flashLender,
      systemShutdown
    }
    return coreContracts
  }

  static async deployTesterContractsHardhat() {
    const testerContracts = {}

    // Contract without testers (yet)
    testerContracts.priceFeedTestnet = await PriceFeedTestnet.new()
    testerContracts.sortedTroves = await SortedTroves.new()
    testerContracts.systemShutdown = await SystemShutdown.new()
    // Actual tester contracts
    testerContracts.communityIssuance = await CommunityIssuanceTester.new("32000000000000000000000000", "999998681227695000")
    testerContracts.activePool = await ActivePoolTester.new()
    testerContracts.defaultPool = await DefaultPoolTester.new()
    testerContracts.stabilityPool = await StabilityPoolTester.new(GAS_COMP)
    testerContracts.gasPool = await GasPool.new()
    testerContracts.collSurplusPool = await CollSurplusPool.new()
    testerContracts.math = await LiquityMathTester.new()
    testerContracts.borrowerOperations = await BorrowerOperationsTester.new(MIN_DEBT, GAS_COMP)
    testerContracts.troveManager = await TroveManagerTester.new(GAS_COMP)
    testerContracts.functionCaller = await FunctionCaller.new()
    testerContracts.hintHelpers = await HintHelpers.new(GAS_COMP)
    testerContracts.flashLender = await FlashLender.new()
    testerContracts.lusdToken =  await LUSDTokenTester.new(
      "LUSD Stablecoin",
      "LUSD",
      testerContracts.troveManager.address,
      testerContracts.stabilityPool.address,
      testerContracts.borrowerOperations.address,
      testerContracts.flashLender.address,
      testerContracts.systemShutdown.address,
    )
    testerContracts.collateral = await MockCollateral.new("Collateral", "CLT")
    return testerContracts
  }

  static async deployLQTYContractsHardhat(bountyAddress, lpRewardsAddress, multisigAddress) {
    const lqtyStaking = await LQTYStaking.new()
    const communityIssuance = await CommunityIssuance.new("32000000000000000000000000", "999998681227695000")
    const lqtyTreasury = await LQTYTreasury.new(0)

    LQTYStaking.setAsDeployed(lqtyStaking)
    CommunityIssuance.setAsDeployed(communityIssuance)
    LQTYTreasury.setAsDeployed(lqtyTreasury)

    // Deploy LQTY Token, passing Community Issuance and Factory addresses to the constructor
    const lqtyToken = await LQTYToken.new(
        [lqtyTreasury.address, bountyAddress, lpRewardsAddress, multisigAddress],
        ["32000000000000000000000000", "2000000000000000000000000", "1333333333333333333333333", "64666666666666666666666667"],
    )
    LQTYToken.setAsDeployed(lqtyToken)

    const LQTYContracts = {
      lqtyStaking,
      communityIssuance,
      lqtyToken,
      lqtyTreasury
    }
    return LQTYContracts
  }

  static async deployLQTYTesterContractsHardhat(bountyAddress, lpRewardsAddress, multisigAddress) {
    const lqtyStaking = await LQTYStaking.new()
    const communityIssuance = await CommunityIssuanceTester.new("32000000000000000000000000", "999998681227695000")
    const lqtyTreasury = await LQTYTreasury.new(0)

    LQTYStaking.setAsDeployed(lqtyStaking)
    CommunityIssuanceTester.setAsDeployed(communityIssuance)
    LQTYTreasury.setAsDeployed(lqtyTreasury)


    // Deploy LQTY Token, passing Community Issuance and Factory addresses to the constructor
    const lqtyToken = await LQTYTokenTester.new(
        [lqtyTreasury.address, bountyAddress, lpRewardsAddress, multisigAddress],
        ["32000000000000000000000000", "2000000000000000000000000", "1333333333333333333333333", "64666666666666666666666667"],
    )
    LQTYTokenTester.setAsDeployed(lqtyToken)

    const LQTYContracts = {
      lqtyStaking,
      communityIssuance,
      lqtyToken,
      lqtyTreasury
    }
    return LQTYContracts
  }

  static async deployLiquityCoreTruffle() {
    const priceFeedTestnet = await PriceFeedTestnet.new()
    const sortedTroves = await SortedTroves.new()
    const troveManager = await TroveManager.new()
    const activePool = await ActivePool.new()
    const stabilityPool = await StabilityPool.new()
    const gasPool = await GasPool.new()
    const defaultPool = await DefaultPool.new()
    const collSurplusPool = await CollSurplusPool.new()
    const functionCaller = await FunctionCaller.new()
    const borrowerOperations = await BorrowerOperations.new()
    const hintHelpers = await HintHelpers.new()
    const lusdToken = await LUSDToken.new(
      troveManager.address,
      stabilityPool.address,
      borrowerOperations.address
    )
    const coreContracts = {
      priceFeedTestnet,
      lusdToken,
      sortedTroves,
      troveManager,
      activePool,
      stabilityPool,
      gasPool,
      defaultPool,
      collSurplusPool,
      functionCaller,
      borrowerOperations,
      hintHelpers
    }
    return coreContracts
  }

  static async deployLQTYContractsTruffle(bountyAddress, lpRewardsAddress, multisigAddress) {
    const lqtyStaking = await lqtyStaking.new()
    const communityIssuance = await CommunityIssuance.new("32000000000000000000000000", "999998681227695000")

    /* Deploy LQTY Token, passing Community Issuance,  LQTYStaking, and Factory addresses
    to the constructor  */
    const lqtyToken = await LQTYToken.new(
      [communityIssuance.address, bountyAddress, lpRewardsAddress, multisigAddress],
      ["32000000000000000000000000", "2000000000000000000000000", "1333333333333333333333333", "64666666666666666666666667"],
    )

    const LQTYContracts = {
      lqtyStaking,
      communityIssuance,
      lqtyToken
    }
    return LQTYContracts
  }

  static async deployLUSDToken(contracts) {
    contracts.lusdToken = await LUSDToken.new(
      "LUSD Stablecoin",
      "LUSD",
      contracts.troveManager.address,
      contracts.stabilityPool.address,
      contracts.borrowerOperations.address,
      contracts.flashLender.address,
      contracts.systemShutdown.address,
    )
    return contracts
  }

  static async deployLUSDTokenTester(contracts) {
    contracts.lusdToken = await LUSDTokenTester.new(
      "LUSD Stablecoin",
      "LUSD",
      contracts.troveManager.address,
      contracts.stabilityPool.address,
      contracts.borrowerOperations.address,
      contracts.flashLender.address,
      contracts.systemShutdown.address,
    )
    return contracts
  }

  // Connect contracts to their dependencies
  static async connectCoreContracts(contracts, LQTYContracts) {

    // set TroveManager addr in SortedTroves
    await contracts.sortedTroves.setParams(
      maxBytes32,
      contracts.troveManager.address,
      contracts.borrowerOperations.address
    )

    // set contract addresses in the FunctionCaller
    await contracts.functionCaller.setTroveManagerAddress(contracts.troveManager.address)
    await contracts.functionCaller.setSortedTrovesAddress(contracts.sortedTroves.address)

    // had to switch troveManager/BorrowerOperations order as troveManager reads
    // collateral token from BorrowerOperations.
    // set contracts in BorrowerOperations
    await contracts.borrowerOperations.setAddresses(
      contracts.troveManager.address,
      contracts.activePool.address,
      contracts.defaultPool.address,
      contracts.stabilityPool.address,
      contracts.gasPool.address,
      contracts.collSurplusPool.address,
      contracts.priceFeedTestnet.address,
      contracts.sortedTroves.address,
      contracts.lusdToken.address,
      LQTYContracts.lqtyStaking.address,
      contracts.collateral.address
    )

    // set contracts in the Trove Manager
    await contracts.troveManager.setAddresses(
      contracts.borrowerOperations.address,
      contracts.activePool.address,
      contracts.defaultPool.address,
      contracts.stabilityPool.address,
      contracts.gasPool.address,
      contracts.collSurplusPool.address,
      contracts.priceFeedTestnet.address,
      contracts.lusdToken.address,
      contracts.sortedTroves.address,
      LQTYContracts.lqtyToken.address,
      LQTYContracts.lqtyStaking.address,
      contracts.collateral.address
    )

    // set contracts in the Pools
    await contracts.stabilityPool.setAddresses(
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      contracts.activePool.address,
      contracts.lusdToken.address,
      contracts.sortedTroves.address,
      contracts.priceFeedTestnet.address,
      LQTYContracts.communityIssuance.address,
      contracts.collateral.address
    )

    await contracts.activePool.setAddresses(
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      contracts.stabilityPool.address,
      contracts.defaultPool.address,
      contracts.flashLender.address,
      contracts.collateral.address
    )

    await contracts.defaultPool.setAddresses(
      contracts.troveManager.address,
      contracts.activePool.address,
      contracts.collateral.address
    )

    await contracts.collSurplusPool.setAddresses(
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      contracts.activePool.address,
      contracts.collateral.address
    )

    // set contracts in HintHelpers
    await contracts.hintHelpers.setAddresses(
      contracts.sortedTroves.address,
      contracts.troveManager.address,
      contracts.borrowerOperations.address
    )

    await contracts.flashLender.setAddresses(
        LQTYContracts.lqtyStaking.address
    )

    await contracts.flashLender.setLendSources(
        [contracts.lusdToken.address, contracts.collateral.address],
        [contracts.lusdToken.address, contracts.activePool.address]
    )
  }

  static async connectLQTYContractsToCore(LQTYContracts, coreContracts) {
    await LQTYContracts.lqtyStaking.setStakingToken(LQTYContracts.lqtyToken.address)
    await LQTYContracts.lqtyStaking.addReward(coreContracts.lusdToken.address, [coreContracts.borrowerOperations.address, coreContracts.troveManager.address])
    const collateral = await coreContracts.troveManager.collateralToken()
    await LQTYContracts.lqtyStaking.addReward(collateral, [coreContracts.troveManager.address, coreContracts.borrowerOperations.address])
    await LQTYContracts.lqtyTreasury.setAddresses(LQTYContracts.lqtyToken.address, [LQTYContracts.communityIssuance.address]);

    await LQTYContracts.communityIssuance.setAddresses(
      LQTYContracts.lqtyToken.address,
      coreContracts.stabilityPool.address,
      LQTYContracts.lqtyTreasury.address,
      coreContracts.systemShutdown.address,
    )
  }

}
module.exports = DeploymentHelper

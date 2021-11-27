const Decimal = require("decimal.js");
const deploymentHelper = require("../utils/deploymentHelpers.js")
const { BNConverter } = require("../utils/BNConverter.js")
const testHelpers = require("../utils/testHelpers.js")
const BN = require('bn.js')

// @TODO LQTYStakingTester
// const LQTYStakingTester = artifacts.require('LQTYStakingTester')
const TroveManagerTester = artifacts.require("TroveManagerTester")
const NonPayable = artifacts.require("./NonPayable.sol")

const th = testHelpers.TestHelper
const timeValues = testHelpers.TimeValues
const dec = th.dec
const assertRevert = th.assertRevert

const toBN = th.toBN
const ZERO = th.toBN('0')

/* NOTE: These tests do not test for specific ETH and LUSD gain values. They only test that the
 * gains are non-zero, occur when they should, and are in correct proportion to the user's stake.
 *
 * Specific ETH/LUSD gain values will depend on the final fee schedule used, and the final choices for
 * parameters BETA and MINUTE_DECAY_FACTOR in the TroveManager, which are still TBD based on economic
 * modelling.
 *
 */

contract('LQTYStaking revenue share tests', async accounts => {

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  const [owner, A, B, C, D, E, F, G, whale] = accounts;

  let priceFeed
  let lusdToken
  let sortedTroves
  let troveManager
  let activePool
  let stabilityPool
  let defaultPool
  let collateralAddress
  let borrowerOperations
  let lqtyStaking
  let lqtyToken

  let contracts
  let collateralAmount = dec(40000, 18);

  const openTrove = async (params) => th.openTrove(contracts, params)

  beforeEach(async () => {
    contracts = await deploymentHelper.deployLiquityCore()
    contracts.troveManager = await TroveManagerTester.new("200000000000000000000")
    contracts = await deploymentHelper.deployLUSDTokenTester(contracts)
    const LQTYContracts = await deploymentHelper.deployLQTYTesterContractsHardhat(bountyAddress, lpRewardsAddress, multisig)

    await deploymentHelper.connectCoreContracts(contracts, LQTYContracts)
    await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, contracts)

    nonPayable = await NonPayable.new()
    priceFeed = contracts.priceFeedTestnet
    lusdToken = contracts.lusdToken
    sortedTroves = contracts.sortedTroves
    troveManager = contracts.troveManager
    activePool = contracts.activePool
    stabilityPool = contracts.stabilityPool
    defaultPool = contracts.defaultPool
    borrowerOperations = contracts.borrowerOperations
    hintHelpers = contracts.hintHelpers
    collateral = contracts.collateral
    lqtyToken = LQTYContracts.lqtyToken
    lqtyStaking = LQTYContracts.lqtyStaking

    // Give the account collateral and approve BO on behalf of the accounts
    for (account of accounts.slice(0, 10)) {
      await collateral.faucet(account, collateralAmount)
      colBal = await contracts.collateral.balanceOf(account)
      await collateral.approve(borrowerOperations.address, collateralAmount, { from: account } )
    }
    // for (account of accounts.slice(999, 1000)) {
    //   await contracts.collateral.faucet(account, collateralAmount)
    //   colBal = await contracts.collateral.balanceOf(account)
    //   await contracts.collateral.approve(borrowerOperations.address, collateralAmount, { from: account } )
    // }

  })

  it("Reward tokens are assigned in MultiRewards", async () => {
    const zero = await lqtyStaking.rewardTokens(0);
    assert.equal(zero, lusdToken.address)

    const one = await lqtyStaking.rewardTokens(1)
    assert.equal(one, collateral.address)
  })

  it('stake(): reverts if amount is zero', async () => {
    // FF time one year so owner can transfer LQTY
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers LQTY to staker A
    await lqtyToken.transfer(A, dec(100, 18), {from: multisig})

    // console.log(`A lqty bal: ${await lqtyToken.balanceOf(A)}`)

    // A makes stake
    await lqtyToken.approve(lqtyStaking.address, dec(100, 18), {from: A})
    await assertRevert(lqtyStaking.stake(0, {from: A}), "Cannot stake 0")
  })

  // Check to ensure that collateral rewards in contract increase when a redemption occurs
  it("ETH fee per LQTY staked increases when a redemption fee is triggered and totalStakes > 0", async () => {
    // FF time one year so owner can transfer LQTY
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

    // multisig transfers LQTY to staker A
    await lqtyToken.transfer(A, dec(100, 18), {from: multisig})

    // console.log(`A lqty bal: ${await lqtyToken.balanceOf(A)}`)

    // A makes stake
    await lqtyToken.approve(lqtyStaking.address, dec(100, 18), {from: A})
    await lqtyStaking.stake(dec(100, 18), {from: A})

    // OLD: Check ETH fee per unit staked is zero
    // const F_ETH_Before = await lqtyStaking.F_ETH()

    // NEW: Check the collateral rewardData.rewardRate
    // (added a check on the actual balance of the contract)
    const Collat_Before = await collateral.balanceOf(lqtyStaking.address);
    assert.equal(Collat_Before, '0')
    const F_ETH_Before = await lqtyStaking.rewardData(collateral.address)
    assert.equal(F_ETH_Before.rewardRate.toString(), '0')

    const B_BalBeforeREdemption = await lusdToken.balanceOf(B)
    // B redeems
    const redemptionTx = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))

    const B_BalAfterRedemption = await lusdToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // check ETH fee emitted in event is non-zero
    const emittedETHFee = toBN((await th.getEmittedRedemptionValues(redemptionTx))[3])
    assert.isTrue(emittedETHFee.gt(toBN('0')))

    // Check that increase in collat in staking contract = ETH fee emitted
    const Collat_After = await collateral.balanceOf(lqtyStaking.address);
    assert.equal(Collat_After.toString(), emittedETHFee.toString())

    // OLD: Check ETH fee per unit staked has increased by correct amount
    // const F_ETH_After = await lqtyStaking.F_ETH()

    // NEW: Check the new collateral rewardData.rewardRate is > old value
    const F_ETH_After = await lqtyStaking.rewardData(collateral.address)
    assert.isTrue(F_ETH_Before.rewardRate.lt(F_ETH_After.rewardRate))

    // OLD: Expect fee per unit staked = fee/(100), since there is 100 LUSD totalStaked
    // const expected_F_ETH_After = emittedETHFee.div(toBN('100'))

    // NEW: Expect F_ETH_After.rewardRate to equal Collat_After/(7*24*60*60)
    const expected_F_ETH_After = (Collat_After/(7*24*60*60)).toFixed(0);
    assert.equal(F_ETH_After.rewardRate.toString(), expected_F_ETH_After.toString())

  })

  it("ETH fee per LQTY staked increases when a redemption fee is triggered and totalStakes == 0", async () => {
    // FF time one year so owner can transfer LQTY
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraLUSDAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // multisig transfers LQTY to staker A
    await lqtyToken.transfer(A, dec(100, 18), {from: multisig})

    // OLD: Check ETH fee per unit staked is zero
    // const F_ETH_Before = await lqtyStaking.F_ETH()

    // NEW: Check the collateral rewardData.rewardRate
    // (added a check on the actual balance of the contract)
    const Collat_Before = await collateral.balanceOf(lqtyStaking.address);
    assert.equal(Collat_Before, '0')
    const F_ETH_Before = await lqtyStaking.rewardData(collateral.address)
    assert.equal(F_ETH_Before.rewardRate.toString(), '0')

    const B_BalBeforeREdemption = await lusdToken.balanceOf(B)
    // B redeems
    const redemptionTx = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))

    const B_BalAfterRedemption = await lusdToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // check ETH fee emitted in event is non-zero
    const emittedETHFee = toBN((await th.getEmittedRedemptionValues(redemptionTx))[3])
    assert.isTrue(emittedETHFee.gt(toBN('0')))

    // NEW: Check the collateral after > before
    // Note: the difference is the emittedETHFee value. Adding that below
    const Collat_After = await collateral.balanceOf(lqtyStaking.address);
    assert.isTrue(Collat_After.gt(Collat_Before))

    Collat_total = Collat_Before.add(emittedETHFee)
    assert.equal(Collat_total.toString(), Collat_After.toString())

    // Check ETH fee per unit staked has increased
    const F_ETH_After = await lqtyStaking.rewardData(collateral.address)
    assert.isTrue(F_ETH_After.rewardRate.gt(F_ETH_Before.rewardRate))

    // assert.equal(F_ETH_After.rewardRate.toString(), '0')
  })

  it("LUSD fee per LQTY staked increases when a redemption fee is triggered and totalStakes > 0", async () => {
    // Moved this up as it was interfering with MultiRewards lastUpdateTime etc.
    // and the decay made it difficult to compare after events
    // FF time one year so owner can transfer LQTY
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // Staking contract has no LUSD at beginning
    const LUSD_Start = await lusdToken.balanceOf(lqtyStaking.address);
    assert.equal(LUSD_Start.toString(), '0')
    const F_LUSD_Start = await lqtyStaking.rewardData(lusdToken.address)
    assert.equal(F_LUSD_Start.rewardRate.toString(), '0')

    // open troves
    const tx1 = await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    const tx2 = await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    const tx3 = await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    const tx4 = await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    const tx5 = await openTrove({ extraLUSDAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // calculate lusd fees sent to staking contract
    const Trove_Fees = tx1.tx.logs[2].args[1].add(tx2.tx.logs[2].args[1]).add(tx3.tx.logs[2].args[1]).add(tx4.tx.logs[2].args[1]).add(tx5.tx.logs[2].args[1]);

    // (added a check on the actual balance of the contract)
    const LUSD_Before = await lusdToken.balanceOf(lqtyStaking.address);
    // Balance in contract equals fees passed from trove openings
    assert.equal(LUSD_Before.toString(), Trove_Fees.toString())
    // NEW: Check the lusd rewardData.rewardRate
    // F_LUSD_Before.rewardRate should approximate (Trove_Fees/(7*24*60*60))
    const F_LUSD_Before = await lqtyStaking.rewardData(lusdToken.address)

    // multisig transfers LQTY to staker A
    await lqtyToken.transfer(A, dec(100, 18), {from: multisig})

    // A makes stake
    await lqtyToken.approve(lqtyStaking.address, dec(100, 18), {from: A})
    await lqtyStaking.stake(dec(100, 18), {from: A})

    const B_BalBeforeREdemption = await lusdToken.balanceOf(B)
    // B redeems
    const redemptionTx = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))

    const B_BalAfterRedemption = await lusdToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // Check base rate is now non-zero
    const baseRate = await troveManager.baseRate()
    assert.isTrue(baseRate.gt(toBN('0')))

    // D draws debt
    const tx = await borrowerOperations.withdrawLUSD(th._100pct, dec(27, 18), D, D, {from: D})

    // Check LUSD fee value in event is non-zero
    const emittedLUSDFee = toBN(th.getLUSDFeeFromLUSDBorrowingEvent(tx))
    assert.isTrue(emittedLUSDFee.gt(toBN('0')))

    // Check LUSD fee per unit staked has increased by correct amount
    // const F_LUSD_After = await lqtyStaking.F_LUSD()
    const F_LUSD_After = await lqtyStaking.rewardData(lusdToken.address)
    const LUSD_After = await lusdToken.balanceOf(lqtyStaking.address);
    assert.isTrue(LUSD_After.gt(LUSD_Before))
    // ensure the total = before (from troves) and the fee from the withdrawal (D draws debt)
    LUSD_total = LUSD_Before.add(emittedLUSDFee)
    assert.equal(LUSD_total.toString(), LUSD_After.toString())


    assert.isTrue(F_LUSD_After.rewardRate.gt(F_LUSD_Before.rewardRate))
    assert.isTrue(LUSD_After.gt(LUSD_Before))

  })

  it("LUSD fee per LQTY staked doesn't change when a redemption fee is triggered and totalStakes == 0", async () => {
    // FF time one year so owner can transfer LQTY
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
    // Staking contract has no LUSD at beginning
    const LUSD_Start = await lusdToken.balanceOf(lqtyStaking.address);
    assert.equal(LUSD_Start.toString(), '0')

    // open troves
    const tx1 = await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    const tx2 = await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    const tx3 = await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    const tx4 = await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    const tx5 = await openTrove({ extraLUSDAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // calculate lusd fees sent to staking contract
    const Trove_Fees = tx1.tx.logs[2].args[1].add(tx2.tx.logs[2].args[1]).add(tx3.tx.logs[2].args[1]).add(tx4.tx.logs[2].args[1]).add(tx5.tx.logs[2].args[1]);

    // multisig transfers LQTY to staker A
    await lqtyToken.transfer(A, dec(100, 18), {from: multisig})

    // OLD: Check LUSD fee per unit staked is zero
    // const F_LUSD_Before = await lqtyStaking.F_ETH()
    // assert.equal(F_LUSD_Before, '0')

    // NEW: Check the collateral rewardData.rewardRate
    // (added a check on the actual balance of the contract)
    const LUSD_Before = await lusdToken.balanceOf(lqtyStaking.address);
    // Balance in contract equals fees passed from trove openings
    assert.equal(LUSD_Before.toString(), Trove_Fees.toString());

    const F_LUSD_Before = await lqtyStaking.rewardData(lusdToken.address)
    // assert.equal(F_LUSD_Before.rewardRate.toString(), '0')

    const B_BalBeforeREdemption = await lusdToken.balanceOf(B)
    // B redeems
    const redemptionTx = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))

    const B_BalAfterRedemption = await lusdToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // Check base rate is now non-zero
    const baseRate = await troveManager.baseRate()
    assert.isTrue(baseRate.gt(toBN('0')))

    // D draws debt
    const tx = await borrowerOperations.withdrawLUSD(th._100pct, dec(27, 18), D, D, {from: D})

    // Check LUSD fee value in event is non-zero
    const emittedLUSDFee = toBN(th.getLUSDFeeFromLUSDBorrowingEvent(tx))
    assert.isTrue(emittedLUSDFee.gt(toBN('0')))

    // // Check LUSD fee per unit staked did not increase, is still zero
    const F_LUSD_After = await lqtyStaking.rewardData(lusdToken.address)
    assert.equal(F_LUSD_After.toString(), F_LUSD_Before.toString())
  })

  // Adapted from the original for the MultiRewards staking contract
  it("LQTY Staking: A single staker earns all ETH and LQTY fees that occur", async () => {
    // FF time past the redepmtion phase which is 2 weeks
    await th.fastForwardTime((timeValues.MINUTES_IN_ONE_WEEK*2*60), web3.currentProvider)
    // multisig transfers LQTY to staker A
    await lqtyToken.transfer(A, dec(100, 18), {from: multisig})

    // A makes stake
    // Here in MultiRewards they start earning from the trove fees.
    // In the original lqtyStaking contract they would not get those trove fees,
    // only subsequent fees.
    await lqtyToken.approve(lqtyStaking.address, dec(100, 18), {from: A})
    await lqtyStaking.stake(dec(100, 18), {from: A})

    // check contract fee balances, assert 0
    const LUSD_Start = await lusdToken.balanceOf(lqtyStaking.address);
    assert.equal(LUSD_Start.toString(), '0')
    const Collat_Start = await collateral.balanceOf(lqtyStaking.address);
    assert.equal(Collat_Start.toString(), '0')
    const A_ETHBalance_Start = toBN(await collateral.balanceOf(A))
    const A_LUSDBalance_Start = toBN(await lusdToken.balanceOf(A))

    await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraLUSDAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // track the fees from the troves. Note that the balances in lqtyStaking
    // were confirmed = 0 in assertions above
    const LUSD_Troves = await lusdToken.balanceOf(lqtyStaking.address);
    const Collat_Troves = await collateral.balanceOf(lqtyStaking.address);

    const B_BalBeforeREdemption = await lusdToken.balanceOf(B)
    // B redeems
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))

    const B_BalAfterRedemption = await lusdToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // check ETH fee 1 emitted in event is non-zero
    const emittedETHFee_1 = toBN((await th.getEmittedRedemptionValues(redemptionTx_1))[3])
    assert.isTrue(emittedETHFee_1.gt(toBN('0')))

    const C_BalBeforeREdemption = await lusdToken.balanceOf(C)
    // C redeems
    const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(100, 18))

    const C_BalAfterRedemption = await lusdToken.balanceOf(C)
    assert.isTrue(C_BalAfterRedemption.lt(C_BalBeforeREdemption))

    // check ETH fee 2 emitted in event is non-zero
    const emittedETHFee_2 = toBN((await th.getEmittedRedemptionValues(redemptionTx_2))[3])
    assert.isTrue(emittedETHFee_2.gt(toBN('0')))

    // D draws debt
    const borrowingTx_1 = await borrowerOperations.withdrawLUSD(th._100pct, dec(104, 18), D, D, {from: D})

    // Check LUSD fee value in event is non-zero
    const emittedLUSDFee_1 = toBN(th.getLUSDFeeFromLUSDBorrowingEvent(borrowingTx_1))
    assert.isTrue(emittedLUSDFee_1.gt(toBN('0')))

    // B draws debt
    const borrowingTx_2 = await borrowerOperations.withdrawLUSD(th._100pct, dec(17, 18), B, B, {from: B})

    // Check LUSD fee value in event is non-zero
    const emittedLUSDFee_2 = toBN(th.getLUSDFeeFromLUSDBorrowingEvent(borrowingTx_2))
    assert.isTrue(emittedLUSDFee_2.gt(toBN('0')))

    // LUSD and Collateral values once all the action has happened.
    // need to stake for a week for this to accrue to the staker
    const LUSD_Rewards = await lusdToken.balanceOf(lqtyStaking.address);
    const Collat_Rewards = await collateral.balanceOf(lqtyStaking.address);

    const expectedTotalETHGain = emittedETHFee_1.add(emittedETHFee_2).add(Collat_Troves)
    const expectedTotalLUSDGain = emittedLUSDFee_1.add(emittedLUSDFee_2).add(LUSD_Troves)


    const A_ETHBalance_Before = toBN(await collateral.balanceOf(A))
    const A_LUSDBalance_Before = toBN(await lusdToken.balanceOf(A))

    // FF time one week so staker gets all the rewards
    await th.fastForwardTime(604801, web3.currentProvider)

    // A un-stakes
    await lqtyStaking.exit({from: A, gasPrice: 0})

    const A_ETHBalance_After = toBN(await collateral.balanceOf(A))
    const A_LUSDBalance_After = toBN(await lusdToken.balanceOf(A))

    const LUSD_After = await lusdToken.balanceOf(lqtyStaking.address);
    const Collat_After = await collateral.balanceOf(lqtyStaking.address);

    const A_ETHGain = A_ETHBalance_After.sub(A_ETHBalance_Before)
    const A_LUSDGain = A_LUSDBalance_After.sub(A_LUSDBalance_Before)

    assert.isAtMost(th.getDifference(expectedTotalETHGain, A_ETHGain), 620000)
    assert.isAtMost(th.getDifference(expectedTotalLUSDGain, A_LUSDGain), 2700000)
  })

  it("unstake(): reverts if user has no stake",  async () => {
    const unstakeTxPromise1 = lqtyStaking.withdraw(1, {from: A})
    const unstakeTxPromise2 = lqtyStaking.withdraw(1, {from: owner})

    await assertRevert(unstakeTxPromise1)
    await assertRevert(unstakeTxPromise2)
  })

  // @TODO LQTYStakingTester
  // it('Test requireCallerIsTroveManager', async () => {
  //   const lqtyStakingTester = await LQTYStakingTester.new()
  //   await assertRevert(lqtyStakingTester.requireCallerIsTroveManager(), 'LQTYStaking: caller is not TroveM')
  // })
})

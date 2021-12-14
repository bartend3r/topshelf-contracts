const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")

const BorrowerOperationsTester = artifacts.require("./BorrowerOperationsTester.sol")
const NonPayable = artifacts.require('NonPayable.sol')
const TroveManagerTester = artifacts.require("TroveManagerTester")
const LUSDTokenTester = artifacts.require("./LUSDTokenTester")

const th = testHelpers.TestHelper

const dec = th.dec
const toBN = th.toBN
const mv = testHelpers.MoneyValues
const timeValues = testHelpers.TimeValues

const ZERO_ADDRESS = th.ZERO_ADDRESS
const assertRevert = th.assertRevert
/*
openTrove
-ETH should be taken from the caller
-a new trove should be opened for _account
-LUSD should be minted for the caller

addColl
-ETH should be taken from the caller and added to the trove of _account

withdrawColl
-ETH should be withdrawn from the trove of _account and sent to the caller

withdrawLUSD
-LUSD should be minted against the trove of _account and sent to the caller

repayLUSD
-LUSD should be taken from the caller and used to repay the trove of _account


closeTrove
-required LUSD should be taken from the caller in order to close the trove of _account
*/

contract('BorrowerOperations', async accounts => {

  const [
    caller, owner, alice, bob, carol, dennis, whale,
    A, B, C, D, E, F, G, H] = accounts;

    const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  // const frontEnds = [frontEnd_1, frontEnd_2, frontEnd_3]

  let priceFeed
  let lusdToken
  let sortedTroves
  let troveManager
  let activePool
  let collSurplusPool
  let stabilityPool
  let defaultPool
  let borrowerOperations
  let lqtyStaking
  let lqtyToken

  let contracts
  let collateralAmount = dec(200, 30);
  let approvalAmount = dec(200, 30);

  const getOpenTroveLUSDAmount = async (totalDebt) => th.getOpenTroveLUSDAmount(contracts, totalDebt)
  const getNetBorrowingAmount = async (debtWithFee) => th.getNetBorrowingAmount(contracts, debtWithFee)
  const getActualDebtFromComposite = async (compositeDebt) => th.getActualDebtFromComposite(compositeDebt, contracts)
  const openTrove = async (params) => th.openTrove(contracts, params)
  const getTroveEntireColl = async (trove) => th.getTroveEntireColl(contracts, trove)
  const getTroveEntireDebt = async (trove) => th.getTroveEntireDebt(contracts, trove)
  const getTroveStake = async (trove) => th.getTroveStake(contracts, trove)

  let LUSD_GAS_COMPENSATION
  let MIN_NET_DEBT
  let BORROWING_FEE_FLOOR
  let A_GAIN
  let CALLER_GAIN


  beforeEach(async () => {
    contracts = await deploymentHelper.deployLiquityCore()
    contracts.borrowerOperations = await BorrowerOperationsTester.new("1800000000000000000000", "200000000000000000000")
    contracts.troveManager = await TroveManagerTester.new("200000000000000000000")
    contracts = await deploymentHelper.deployLUSDTokenTester(contracts)
    const LQTYContracts = await deploymentHelper.deployLQTYTesterContractsHardhat(bountyAddress, lpRewardsAddress, multisig)

    await deploymentHelper.connectCoreContracts(contracts, LQTYContracts)
    await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, contracts)


    priceFeed = contracts.priceFeedTestnet
    lusdToken = contracts.lusdToken
    sortedTroves = contracts.sortedTroves
    troveManager = contracts.troveManager
    activePool = contracts.activePool
    stabilityPool = contracts.stabilityPool
    collSurplusPool = contracts.collSurplusPool
    defaultPool = contracts.defaultPool
    borrowerOperations = contracts.borrowerOperations
    hintHelpers = contracts.hintHelpers
    lqtyStaking = LQTYContracts.lqtyStaking
    lqtyToken = LQTYContracts.lqtyToken
    communityIssuance = LQTYContracts.communityIssuance
    collateral = contracts.collateral
    LUSD_GAS_COMPENSATION = await borrowerOperations.LUSD_GAS_COMPENSATION()
    MIN_NET_DEBT = await borrowerOperations.minNetDebt()
    BORROWING_FEE_FLOOR = await borrowerOperations.BORROWING_FEE_FLOOR()

    for (account of accounts.slice(0, 14)) {
      await collateral.faucet(account, collateralAmount)
      await collateral.approve(borrowerOperations.address, approvalAmount, { from: account } )
      await collateral.approve(activePool.address, approvalAmount, { from: account } )
    }

  })

  it("openTrove(): reverts if owner has not approved caller", async () => {
    try {
      // caller attemtps to create a Trove for owner and add first collateral
      const { collateral: ownerColl, lusdAmount: ownerLusd } = await openTrove({ ICR: toBN(dec(2, 18)), extraParams: {troveFor: owner,  from: caller } })
      // owner should have 0 LUSD      
      assert.equal(ownerLusd.toString(), 0)

    } catch (error) {
      assert.include(error.message, "revert")
    }


  })

  // -ETH should be taken from the caller
  // -a new trove should be opened for _account
  // -LUSD should be minted for the caller    
  it("openTrove(): caller can open for owner, send caller's collateral and caller receives LUSD", async () => {
    const ownerCollBefore = await collateral.balanceOf(owner);
    const ownerLUSDBefore = await lusdToken.balanceOf(owner);
    const callerCollBefore = await collateral.balanceOf(caller);
    const callerLUSDBefore = await lusdToken.balanceOf(caller);
    // caller should have 0 LUSD to begin with
    assert.equal(callerLUSDBefore, 0)
    // owner should have 0 LUSD
    assert.equal(ownerLUSDBefore, 0)

    // owner delegates to caller
    await borrowerOperations.setDelegateApproval(caller, true, { from: owner })
    // check 
    assert.isTrue(await borrowerOperations.isApprovedDelegate(owner, caller));

    // caller creates a Trove for owner and adds first collateral
    const { collateral: recCollat, lusdAmount: recLusd } = await openTrove({ ICR: toBN(dec(2, 18)), extraParams: {troveFor: owner,  from: caller } })
    
    // check trove status, 1 = active for owner's address
    const troveStatusOwner = await troveManager.getTroveStatus(owner);
    assert.equal(troveStatusOwner.toString(), '1')

    // check trove status, 0 = doesn't exist, for caller's address
    const troveStatusCaller = await troveManager.getTroveStatus(caller);
    assert.equal(troveStatusCaller.toString(), '0')

    const ownerCollAfter = await collateral.balanceOf(owner);
    const ownerLUSDAfter = await lusdToken.balanceOf(owner);
    const callerCollAfter = await collateral.balanceOf(caller);
    const callerLUSDAfter = await lusdToken.balanceOf(caller);

    // this assertion checks that the caller received the LUSD
    assert.equal(callerLUSDAfter.toString(), recLusd.toString())
    // this checks to see if caller's collat balance has gone down
    assert.isTrue(callerCollBefore.gt(callerCollAfter))
    // some extra pedantic assertions below
    // these assertions checks that the owner's balances were not affected
    assert.equal(ownerCollAfter.toString(), ownerCollBefore.toString())
    assert.equal(ownerLUSDBefore.toString(), ownerLUSDBefore.toString())
    // owner should have 0 LUSD
    assert.equal(ownerLUSDAfter, 0)

  })

  //   addColl
  // -ETH should be taken from the caller and added to the trove of _account
  it("addColl(): ETH should be taken from the caller and added to the trove of _account", async () => {
    const ownerCollateralStart = await collateral.balanceOf(owner);
    // owner delegates to caller
    await borrowerOperations.setDelegateApproval(caller, true, { from: owner })
    // check 
    assert.isTrue(await borrowerOperations.isApprovedDelegate(owner, caller));

    const callerCollBeforeTrove = await collateral.balanceOf(caller);
    // caller creates a Trove for owner and adds first collateral
    const { collateral: troveColl, lusdAmount: troveLusd } = await openTrove({ ICR: toBN(dec(2, 18)), extraParams: {troveFor: owner,  from: caller } })

    const callerCollBefore = await collateral.balanceOf(caller);
    const topUp = toBN(dec(5, 'ether'));
    await borrowerOperations.addColl(owner, topUp, owner, owner, { from: caller })
    const callerCollAfter = await collateral.balanceOf(caller);
    assert.equal(callerCollAfter.toString(), callerCollBefore.sub(topUp).toString());

    // pedantic check on owner's collateral
    const ownerCollateralEnd = await collateral.balanceOf(owner);
    assert.equal(ownerCollateralEnd.toString(), ownerCollateralStart.toString());
  })

  // withdrawColl
  // -ETH should be withdrawn from the trove of _account and sent to the caller
  it("withdrawColl(): ETH should be withdrawn from the trove of _account and sent to the caller", async () => {
    const ownerCollateralStart = await collateral.balanceOf(owner);
    // owner delegates to caller
    await borrowerOperations.setDelegateApproval(caller, true, { from: owner })

    const callerCollBeforeTrove = await collateral.balanceOf(caller);
    // caller creates a Trove for owner and adds first collateral
    const { collateral: troveColl, lusdAmount: troveLusd } = await openTrove({ ICR: toBN(dec(2, 18)), extraParams: {troveFor: owner,  from: caller } })
 
    const callerCollBefore = await collateral.balanceOf(caller);
    const remove = toBN(dec(5, 'ether'));
    await borrowerOperations.withdrawColl(owner, remove, owner, owner, { from: caller })
    const callerCollAfter = await collateral.balanceOf(caller);
    assert.equal(callerCollAfter.toString(), callerCollBefore.add(remove).toString());

    // pedantic check on owner's collateral
    const ownerCollateralEnd = await collateral.balanceOf(owner);
    assert.equal(ownerCollateralEnd.toString(), ownerCollateralStart.toString());
  })

  it("withdrawLUSD(): LUSD should be minted against the trove of _account and sent to the caller", async () => {
    const ownerLUSDStart = await lusdToken.balanceOf(owner);
    // owner delegates to caller
    await borrowerOperations.setDelegateApproval(caller, true, { from: owner })

    // caller creates a Trove for owner and adds first collateral
    const { collateral: troveColl, lusdAmount: troveLusd } = await openTrove({ ICR: toBN(dec(2, 18)), extraParams: {troveFor: owner,  from: caller } })

    const callerLUSDBefore = await lusdToken.balanceOf(caller);
    const withdrawLUSD = toBN(dec(1, 18));
    await borrowerOperations.withdrawLUSD(owner, th._100pct, withdrawLUSD, owner, owner, { from: caller })
    const callerLUSDAfter = await lusdToken.balanceOf(caller);
    assert.equal(callerLUSDAfter.toString(), callerLUSDBefore.add(withdrawLUSD).toString());

    // pedantic check on owner's lusdToken
    const ownerLUSDEnd = await lusdToken.balanceOf(owner);
    assert.equal(ownerLUSDEnd.toString(), ownerLUSDStart.toString());
  })    

  it("repayLUSD(): LUSD should be taken from the caller and used to repay the trove of _account", async () => {
    const ownerLUSDStart = await lusdToken.balanceOf(owner);
    // owner delegates to caller
    await borrowerOperations.setDelegateApproval(caller, true, { from: owner })

    // caller creates a Trove for owner and adds first collateral
    const { collateral: troveColl, lusdAmount: troveLusd } = await openTrove({ extraLUSDAmount: toBN(dec(60, 18)), ICR: toBN(dec(2, 18)), extraParams: {troveFor: owner,  from: caller } })
    
    const callerLUSDBefore = await lusdToken.balanceOf(caller);
    const repayLUSD = toBN(dec(1, 18));
    await borrowerOperations.repayLUSD(owner, repayLUSD, owner, owner, { from: caller })
    const callerLUSDAfter = await lusdToken.balanceOf(caller);
    assert.equal(callerLUSDAfter.toString(), callerLUSDBefore.sub(repayLUSD).toString());

    // pedantic check on owner's collateral
    const ownerLUSDEnd = await lusdToken.balanceOf(owner);
    assert.equal(ownerLUSDEnd.toString(), ownerLUSDStart.toString());
  })    

  it("closeTrove(): required LUSD should be taken from the caller in order to close the trove of _account", async () => {
    const ownerLUSDStart = await lusdToken.balanceOf(owner);
    // owner delegates to caller
    await borrowerOperations.setDelegateApproval(caller, true, { from: owner })
    
    // caller creates a Trove for owner and adds first collateral
    const { collateral: troveColl, lusdAmount: troveLusd } = await openTrove({ ICR: toBN(dec(2, 18)), extraParams: {troveFor: owner,  from: caller } })
    // need more LUSD to caller in order to close owner's trove, so open a second trove
    await borrowerOperations.setDelegateApproval(caller, true, { from: alice })
    const { lusdAmount: aliceLusd } = await openTrove({ ICR: toBN(dec(2, 18)), extraParams: {troveFor: alice,  from: caller } })

    const callerLUSDBefore = await lusdToken.balanceOf(caller);
    await borrowerOperations.closeTrove(owner, { from: caller })
    const callerLUSDAfter = await lusdToken.balanceOf(caller);
    // caller's balance affected by the close:
    assert.isTrue(callerLUSDBefore.gt(callerLUSDAfter))

    // pedantic check on owner's lusdToken
    const ownerLUSDEnd = await lusdToken.balanceOf(owner);
    assert.equal(ownerLUSDEnd.toString(), ownerLUSDStart.toString());
  })    

  const redeemCollateral3Full1Partial = async () => {
    // time fast-forwards 1 year, and multisig stakes 1 LQTY
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
    await lqtyToken.approve(lqtyStaking.address, dec(1, 18), { from: multisig })
    await lqtyStaking.stake(dec(1, 18), { from: multisig })

    const { netDebt: W_netDebt } = await openTrove({ ICR: toBN(dec(20, 18)), extraLUSDAmount: dec(10000, 18), extraParams: { from: whale } })
    await borrowerOperations.setDelegateApproval(caller, true, { from: A })
    await borrowerOperations.setDelegateApproval(caller, true, { from: B })
    await borrowerOperations.setDelegateApproval(caller, true, { from: C })

    const { netDebt: A_netDebt, collateral: A_coll } = await openTrove({ ICR: toBN(dec(200, 16)), extraLUSDAmount: dec(100, 18), extraParams: { troveFor: A,  from: caller } })
    const { netDebt: B_netDebt, collateral: B_coll } = await openTrove({ ICR: toBN(dec(190, 16)), extraLUSDAmount: dec(100, 18), extraParams: { troveFor: B,  from: caller } })
    const { netDebt: C_netDebt, collateral: C_coll } = await openTrove({ ICR: toBN(dec(180, 16)), extraLUSDAmount: dec(100, 18), extraParams: { troveFor: C,  from: caller } })
    const { netDebt: D_netDebt } = await openTrove({ ICR: toBN(dec(280, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: D } })
    const redemptionAmount = A_netDebt.add(B_netDebt).add(C_netDebt).add(toBN(dec(10, 18)))

    const A_balanceBefore = toBN(await  contracts.collateral.balanceOf(A))
    const B_balanceBefore = toBN(await  contracts.collateral.balanceOf(B))
    const C_balanceBefore = toBN(await  contracts.collateral.balanceOf(C))
    const D_balanceBefore = toBN(await  contracts.collateral.balanceOf(D))

    const A_collBefore = await troveManager.getTroveColl(A)
    const B_collBefore = await troveManager.getTroveColl(B)
    const C_collBefore = await troveManager.getTroveColl(C)
    const D_collBefore = await troveManager.getTroveColl(D)

    // Confirm baseRate before redemption is 0
    const baseRate = await troveManager.baseRate()
    assert.equal(baseRate, '0')

    // whale redeems LUSD.  Expect this to fully redeem A, B, C, and partially redeem D.
    await th.redeemCollateral(whale, contracts, redemptionAmount)

    // Check A, B, C have been closed
    assert.isFalse(await sortedTroves.contains(A))
    assert.isFalse(await sortedTroves.contains(B))
    assert.isFalse(await sortedTroves.contains(C))

    // Check D stays active
    assert.isTrue(await sortedTroves.contains(D))

    /*
    At ETH:USD price of 200, with full redemptions from A, B, C:

    ETHDrawn from A = 100/200 = 0.5 ETH --> Surplus = (1-0.5) = 0.5
    ETHDrawn from B = 120/200 = 0.6 ETH --> Surplus = (1-0.6) = 0.4
    ETHDrawn from C = 130/200 = 0.65 ETH --> Surplus = (2-0.65) = 1.35
    */

    const A_balanceAfter = toBN(await  contracts.collateral.balanceOf(A))
    const B_balanceAfter = toBN(await  contracts.collateral.balanceOf(B))
    const C_balanceAfter = toBN(await  contracts.collateral.balanceOf(C))
    const D_balanceAfter = toBN(await  contracts.collateral.balanceOf(D))

    // Check A, B, C’s trove collateral balance is zero (fully redeemed-from troves)
    const A_collAfter = await troveManager.getTroveColl(A)
    const B_collAfter = await troveManager.getTroveColl(B)
    const C_collAfter = await troveManager.getTroveColl(C)
    assert.isTrue(A_collAfter.eq(toBN(0)))
    assert.isTrue(B_collAfter.eq(toBN(0)))
    assert.isTrue(C_collAfter.eq(toBN(0)))

    // check D's trove collateral balances have decreased (the partially redeemed-from trove)
    const D_collAfter = await troveManager.getTroveColl(D)
    assert.isTrue(D_collAfter.lt(D_collBefore))

    // Check A, B, C (fully redeemed-from troves), and D's (the partially redeemed-from trove) balance has not changed
    assert.isTrue(A_balanceAfter.eq(A_balanceBefore))
    assert.isTrue(B_balanceAfter.eq(B_balanceBefore))
    assert.isTrue(C_balanceAfter.eq(C_balanceBefore))
    assert.isTrue(D_balanceAfter.eq(D_balanceBefore))

    // D is not closed, so cannot open trove
    await assertRevert(borrowerOperations.openTrove(D, th._100pct, dec(10, 18), 0, ZERO_ADDRESS, ZERO_ADDRESS, { from: D }), 'BorrowerOps: Trove is active')

    return {
      A_netDebt, A_coll,
      B_netDebt, B_coll,
      C_netDebt, C_coll,
    }
  }  
  it("redeemCollateral(): a redemption that closes a trove leaves the trove's ETH surplus (collateral - ETH drawn) available for the delegator to claim", async () => {
    const {
      A_netDebt, A_coll,
      B_netDebt, B_coll,
      C_netDebt, C_coll,
    } = await redeemCollateral3Full1Partial()

    const A_balanceBefore = toBN(await  contracts.collateral.balanceOf(A))
    const B_balanceBefore = toBN(await  contracts.collateral.balanceOf(B))
    const C_balanceBefore = toBN(await  contracts.collateral.balanceOf(C))

    // CollSurplusPool endpoint cannot be called directly
    await assertRevert(collSurplusPool.claimColl(A, A), 'CollSurplusPool: Caller is not Borrower Operations')

    assert(await borrowerOperations.claimCollateral(A, { from: caller, gasPrice: 0 }))
    assert(await borrowerOperations.claimCollateral(B, { from: caller, gasPrice: 0 }))
    assert(await borrowerOperations.claimCollateral(C, { from: caller, gasPrice: 0 }))

  })

  it("redeemCollateral(): a redemption that closes a trove leaves the trove's ETH surplus (collateral - ETH drawn) available; owner claims, caller cannot", async () => {
    const {
      A_netDebt, A_coll,
      B_netDebt, B_coll,
      C_netDebt, C_coll,
    } = await redeemCollateral3Full1Partial()

    const A_balanceBefore = toBN(await contracts.collateral.balanceOf(A))
    const B_balanceBefore = toBN(await  contracts.collateral.balanceOf(B))
    const C_balanceBefore = toBN(await  contracts.collateral.balanceOf(C))

    // CollSurplusPool endpoint cannot be called directly
    await assertRevert(collSurplusPool.claimColl(A, A), 'CollSurplusPool: Caller is not Borrower Operations')
    
    // tx in try/catch should fail, if it doesn't then caller's collat balance should increase
    const caller_balanceBefore = toBN(await contracts.collateral.balanceOf(caller));
    assert(await borrowerOperations.claimCollateral(A, { from: A, gasPrice: 0 }))
    try {
      const tx = await borrowerOperations.claimCollateral(A, { from: caller, gasPrice: 0 })
    } catch (err) {
      assert.include(err.message, "CollSurplusPool: No collateral available to claim")
    }
    const caller_balanceAfter = toBN(await contracts.collateral.balanceOf(caller));
    // if the TX above passes, the this will fail:
    assert.equal(caller_balanceAfter.toString(), caller_balanceBefore.toString());
    
    const a_after = await contracts.collateral.balanceOf(A);
    A_GAIN = a_after.sub(A_balanceBefore);
  })

  it("redeemCollateral(): a redemption that closes a trove leaves the trove's ETH surplus (collateral - ETH drawn) available; caller claims, owner cannot", async () => {
    const {
      A_netDebt, A_coll,
      B_netDebt, B_coll,
      C_netDebt, C_coll,
    } = await redeemCollateral3Full1Partial()

    const A_balanceBefore = toBN(await  contracts.collateral.balanceOf(A))
    const B_balanceBefore = toBN(await  contracts.collateral.balanceOf(B))
    const C_balanceBefore = toBN(await  contracts.collateral.balanceOf(C))
    const caller_balanceBefore = toBN(await contracts.collateral.balanceOf(caller))

    // CollSurplusPool endpoint cannot be called directly
    await assertRevert(collSurplusPool.claimColl(A, A), 'CollSurplusPool: Caller is not Borrower Operations')
    
    // tx in try/catch should fail, if it doesn't then owner's collat balance should increase
    const owner_balanceBefore = toBN(await contracts.collateral.balanceOf(A))
    assert(await borrowerOperations.claimCollateral(A, { from: caller, gasPrice: 0 }))
    try {
      const tx = await borrowerOperations.claimCollateral(A, { from: A, gasPrice: 0 })
    } catch (err) {
       assert.include(err.message, "CollSurplusPool: No collateral available to claim")
    }
    const owner_balanceAfter = toBN(await contracts.collateral.balanceOf(A));
    // if the TX above passes, the this will fail:
    assert.equal(owner_balanceAfter.toString(), owner_balanceBefore.toString());
    const caller_after = await contracts.collateral.balanceOf(caller);

    CALLER_GAIN = caller_after.sub(caller_balanceBefore);
  })

  it("redeemCollateral(): caller and owner's claims on collat surplus is equal", async () => {
    assert.equal(CALLER_GAIN.toString(), A_GAIN.toString());
  })



})

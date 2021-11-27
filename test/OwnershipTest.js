const deploymentHelper = require("../utils/deploymentHelpers.js")
const { TestHelper: th, MoneyValues: mv } = require("../utils/testHelpers.js")

const GasPool = artifacts.require("./GasPool.sol")
const BorrowerOperationsTester = artifacts.require("./BorrowerOperationsTester.sol")

contract('All Liquity functions with onlyOwner modifier', async accounts => {

  const [owner, alice, bob] = accounts;

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  let contracts
  let lusdToken
  let sortedTroves
  let troveManager
  let activePool
  let stabilityPool
  let defaultPool
  let borrowerOperations

  let lqtyStaking
  let communityIssuance
  let lqtyToken

  beforeEach(async () => {
    contracts = await deploymentHelper.deployLiquityCore()
    // contracts.borrowerOperations = await BorrowerOperationsTester.new()
    contracts = await deploymentHelper.deployLUSDToken(contracts)
    const LQTYContracts = await deploymentHelper.deployLQTYContracts(bountyAddress, lpRewardsAddress, multisig)

    lusdToken = contracts.lusdToken
    collSurplusPool = contracts.collSurplusPool
    sortedTroves = contracts.sortedTroves
    troveManager = contracts.troveManager
    activePool = contracts.activePool
    stabilityPool = contracts.stabilityPool
    defaultPool = contracts.defaultPool
    borrowerOperations = contracts.borrowerOperations
    flashLender = contracts.flashLender
    collateral = contracts.collateral
    priceFeed = contracts.priceFeedTestnet
    gasPool = contracts.gasPool
    lqtyStaking = LQTYContracts.lqtyStaking
    lqtyTreasury = LQTYContracts.lqtyTreasury
    communityIssuance = LQTYContracts.communityIssuance
    lqtyToken = LQTYContracts.lqtyToken
  })

  const testZeroAddress = async (contract, params, method = 'setAddresses', skip = 0) => {
    await testWrongAddress(contract, params, th.ZERO_ADDRESS, method, skip, 'Account cannot be zero address')
  }
  const testNonContractAddress = async (contract, params, method = 'setAddresses', skip = 0) => {
    await testWrongAddress(contract, params, bob, method, skip, 'Account code size cannot be zero')
  }
  const testWrongAddress = async (contract, params, address, method, skip, message) => {
    for (let i = skip; i < params.length; i++) {
      const newParams = [...params]
      newParams[i] = address
      await th.assertRevert(contract[method](...newParams, { from: owner }), message)
    }
  }

  const testSetAddresses = async (contract, addresses) => {
    // Attempt call from alice
    await th.assertRevert(contract.setAddresses(...addresses, { from: alice }))

    // // Attempt to use zero address
    await testZeroAddress(contract, addresses)
    // // Attempt to use non contract
    await testNonContractAddress(contract, addresses)

    // Owner can successfully set any address
    const txOwner = await contract.setAddresses(...addresses, { from: owner })
    assert.isTrue(txOwner.receipt.status)
    // fails if called twice
    await th.assertRevert(contract.setAddresses(...addresses, { from: owner }))
  }

  describe('TroveManager', async accounts => {
    it("setAddresses(): reverts when called by non-owner, with wrong addresses, or twice", async () => {
      const dumbContract = await GasPool.new()
      let params = [
        borrowerOperations.address,
        activePool.address,
      ]
      const moreParams = Array(9).fill(dumbContract.address)
      params.push(...moreParams)

      await testSetAddresses(troveManager, params)
    })
  })

  describe('BorrowerOperations', async accounts => {
    it("setAddresses(): reverts when called by non-owner, with wrong addresses, or twice", async () => {
      const dumbContract = await GasPool.new()
      let params = []
      const moreParams = Array(11).fill(dumbContract.address)
      params.push(...moreParams)
      await testSetAddresses(borrowerOperations, params)
    })
  })

  describe('DefaultPool', async accounts => {
    it("setAddresses(): reverts when called by non-owner, with wrong addresses, or twice", async () => {
      const dumbContract = await GasPool.new()
      let params = [dumbContract.address, activePool.address]
      await testSetAddresses(defaultPool, params)
    })
  })

  describe('StabilityPool', async accounts => {
    it("setAddresses(): reverts when called by non-owner, with wrong addresses, or twice", async () => {
      const dumbContract = await GasPool.new()
      let params = [borrowerOperations.address]
      const moreParams = Array(6).fill(dumbContract.address)
      params.push(...moreParams)
      await testSetAddresses(stabilityPool, params)
    })
  })

  describe('ActivePool', async accounts => {
    it("setAddresses(): reverts when called by non-owner, with wrong addresses, or twice", async () => {
      // need a properly set BO here for the collateral contract call within
      borrowerOperations.setAddresses(
        troveManager.address,
        activePool.address,
        defaultPool.address,
        stabilityPool.address,
        gasPool.address,
        collSurplusPool.address,
        priceFeed.address,
        sortedTroves.address,
        lusdToken.address,
        lqtyStaking.address,
        collateral.address)
      // const dumbContract = await GasPool.new()
      let params = [borrowerOperations.address, troveManager.address, stabilityPool.address, defaultPool.address, flashLender.address]
      // const moreParams = Array(0).fill(dumbContract.address)
      // params.push(...moreParams)
      await testSetAddresses(activePool, params)
    })
  })

  describe('SortedTroves', async accounts => {
    it("setParams(): reverts when called by non-owner, with wrong addresses, or twice", async () => {
      const dumbContract = await GasPool.new()
      const params = [10000001, dumbContract.address, dumbContract.address]

      // Attempt call from alice
      await th.assertRevert(sortedTroves.setParams(...params, { from: alice }))

      // Attempt to use zero address
      await testZeroAddress(sortedTroves, params, 'setParams', 1)
      // Attempt to use non contract
      await testNonContractAddress(sortedTroves, params, 'setParams', 1)

      // Owner can successfully set params
      const txOwner = await sortedTroves.setParams(...params, { from: owner })
      assert.isTrue(txOwner.receipt.status)

      // fails if called twice
      await th.assertRevert(sortedTroves.setParams(...params, { from: owner }))
    })
  })

  describe('CommunityIssuance', async accounts => {
    it("setAddresses(): reverts when called by non-owner, with wrong addresses, or twice", async () => {
      // a bit lazy here adding the lqtyTreasury.address as the last param which is
      // the shutdown address, but the test should fail due to the call from alice
      // and the onlyOwner modifier.
      const params = [lqtyToken.address, stabilityPool.address, lqtyTreasury.address, lqtyTreasury.address]
      await th.assertRevert(communityIssuance.setAddresses(...params, { from: alice }))

      // Attempt to use zero address
      await testZeroAddress(communityIssuance, params)
      // Attempt to use non contract
      await testNonContractAddress(communityIssuance, params)
      await lqtyTreasury.setAddresses(lqtyToken.address, [communityIssuance.address], { from: owner })

      // Owner can successfully set any address
      const txOwner = await communityIssuance.setAddresses(...params, { from: owner })

      assert.isTrue(txOwner.receipt.status)
      // fails if called twice
      await th.assertRevert(communityIssuance.setAddresses(...params, { from: owner }))
    })
  })
  // // remove as multirewards replaces LQTYStaking and does not have setAddresses
  // describe('LQTYStaking', async accounts => {
  //   it("setAddresses(): reverts when called by non-owner, with wrong addresses, or twice", async () => {
  //     await testSetAddresses(lqtyStaking, 5)
  //   })
  // })

})


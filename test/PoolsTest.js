const StabilityPool = artifacts.require("./StabilityPool.sol")
const ActivePool = artifacts.require("./ActivePool.sol")
const DefaultPool = artifacts.require("./DefaultPool.sol")
const NonPayable = artifacts.require("./NonPayable.sol")

const testHelpers = require("../utils/testHelpers.js")

const th = testHelpers.TestHelper
const dec = th.dec

const _minus_1_Ether = web3.utils.toWei('-1', 'ether')

contract('StabilityPool', async accounts => {
  /* mock* are EOA’s, temporarily used to call protected functions.
  TODO: Replace with mock contracts, and later complete transactions from EOA
  */
  let stabilityPool

  const [owner, alice] = accounts;

  beforeEach(async () => {
    stabilityPool = await StabilityPool.new()
    const mockActivePoolAddress = (await NonPayable.new()).address
    const dumbContractAddress = (await NonPayable.new()).address
    await stabilityPool.setAddresses(dumbContractAddress, dumbContractAddress, mockActivePoolAddress, dumbContractAddress, dumbContractAddress, dumbContractAddress, dumbContractAddress)
  })

  it('getETH(): gets the recorded ETH balance', async () => {
    const recordedETHBalance = await stabilityPool.getETH()
    assert.equal(recordedETHBalance, 0)
  })

  it('getTotalLUSDDeposits(): gets the recorded LUSD balance', async () => {
    const recordedETHBalance = await stabilityPool.getTotalLUSDDeposits()
    assert.equal(recordedETHBalance, 0)
  })
})


contract('DefaultPool', async accounts => {
 
  let defaultPool, mockTroveManager, mockActivePool

  const [owner, alice] = accounts;
  beforeEach(async () => {
    defaultPool = await DefaultPool.new()
    mockTroveManager = await NonPayable.new()
    mockActivePool = await NonPayable.new()
    await defaultPool.setAddresses(mockTroveManager.address, mockActivePool.address)
  })

  it('getETH(): gets the recorded ETH balance', async () => {
    const recordedETHBalance = await defaultPool.getETH()
    assert.equal(recordedETHBalance, 0)
  })

  it('getLUSDDebt(): gets the recorded LUSD balance', async () => {
    const recordedETHBalance = await defaultPool.getLUSDDebt()
    assert.equal(recordedETHBalance, 0)
  })
 
  it('increaseLUSD(): increases the recorded LUSD balance by the correct amount', async () => {
    const recordedLUSD_balanceBefore = await defaultPool.getLUSDDebt()
    assert.equal(recordedLUSD_balanceBefore, 0)

    // await defaultPool.increaseLUSDDebt(100, { from: mockTroveManagerAddress })
    const increaseLUSDDebtData = th.getTransactionData('increaseLUSDDebt(uint256)', ['0x64'])
    const tx = await mockTroveManager.forward(defaultPool.address, increaseLUSDDebtData)
    assert.isTrue(tx.receipt.status)

    const recordedLUSD_balanceAfter = await defaultPool.getLUSDDebt()
    assert.equal(recordedLUSD_balanceAfter, 100)
  })
  
  it('decreaseLUSD(): decreases the recorded LUSD balance by the correct amount', async () => {
    // start the pool on 100 wei
    //await defaultPool.increaseLUSDDebt(100, { from: mockTroveManagerAddress })
    const increaseLUSDDebtData = th.getTransactionData('increaseLUSDDebt(uint256)', ['0x64'])
    const tx1 = await mockTroveManager.forward(defaultPool.address, increaseLUSDDebtData)
    assert.isTrue(tx1.receipt.status)

    const recordedLUSD_balanceBefore = await defaultPool.getLUSDDebt()
    assert.equal(recordedLUSD_balanceBefore, 100)

    // await defaultPool.decreaseLUSDDebt(100, { from: mockTroveManagerAddress })
    const decreaseLUSDDebtData = th.getTransactionData('decreaseLUSDDebt(uint256)', ['0x64'])
    const tx2 = await mockTroveManager.forward(defaultPool.address, decreaseLUSDDebtData)
    assert.isTrue(tx2.receipt.status)

    const recordedLUSD_balanceAfter = await defaultPool.getLUSDDebt()
    assert.equal(recordedLUSD_balanceAfter, 0)
  })

})

contract('Reset chain state', async accounts => {})

// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../PriceFeed.sol";

contract PriceFeedTester is PriceFeed {

    constructor(
        address _chainlinkOracleAddress,
        address _bandOracleAddress,
        address _baseStableSwap,
        string memory _bandBase,
        string memory _bandQuote
    ) public PriceFeed(_chainlinkOracleAddress, _bandOracleAddress, _baseStableSwap, _bandBase, _bandQuote) {}

    function setLastGoodPrice(uint _lastGoodPrice) external {
        lastGoodPrice = _lastGoodPrice;
    }

    function setStatus(Status _status) external {
        status = _status;
    }
}

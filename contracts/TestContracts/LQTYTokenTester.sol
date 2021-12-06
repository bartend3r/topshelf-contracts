// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../LQTY/LQTYToken.sol";

contract LQTYTokenTester is LQTYToken {
    constructor
    (
        address[] memory _receivers,
        uint[] memory _amounts
    )
        public
        LQTYToken
    (
        address(0),
        uint256(-1),
        _receivers,
        _amounts
    )
    {}

    function unprotectedMint(address account, uint256 amount) external {
        // No check for the caller here

        _mint(account, amount);
    }

    function callInternalApprove(address owner, address spender, uint256 amount) external returns (bool) {
        _approve(owner, spender, amount);
    }

    function callInternalTransfer(address sender, address recipient, uint256 amount) external returns (bool) {
        _transfer(sender, recipient, amount);
    }

    function getChainId() external pure returns (uint256 chainID) {
        //return _chainID(); // it’s private
        assembly {
            chainID := chainid()
        }
    }
}

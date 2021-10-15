// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../Dependencies/IERC20.sol";

interface IAnySwapERC20 is IERC20 {

    function Swapout(uint256 amount, address bindaddr) external returns (bool);

}

// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../Dependencies/IERC20.sol";
import "../Interfaces/ICommunityIssuance.sol";
import "../Dependencies/Ownable.sol";
import "../Dependencies/SafeMath.sol";


contract IncentiveGauge is Ownable {
    using SafeMath for uint256;

    IERC20 public lqtyToken;
    ICommunityIssuance public communityIssuance;

    uint256 public issued;
    uint256 public available;

    constructor(address _lqtyTokenAddress, address _communityIssuanceAddress) public Ownable() {
        lqtyToken = IERC20(_lqtyTokenAddress);
        communityIssuance = ICommunityIssuance(_communityIssuanceAddress);
    }

    function updateAvailable() external {
        uint256 issuance = communityIssuance.issueLQTY();
        available = available.add(issuance);
    }

    function sendTokens(address _account, uint _amount) external onlyOwner {
        uint256 issuance = communityIssuance.issueLQTY();
        available = available.add(issuance);
        available = available.sub(_amount, "Exceeds available amount");
        communityIssuance.sendLQTY(_account, _amount);
        issued = issued.add(_amount);
    }

}

// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.6.11;

import "../Dependencies/SafeMath.sol";
import "../Dependencies/IERC20.sol";

contract MerkleDistributor {
    using SafeMath for uint256;

    IERC20 public immutable token;
    uint256 public immutable startTime;
    uint256 public constant duration = 86400 * 7;
    bytes32 public immutable merkleRoot;

    event Claimed(
        address account,
        uint256 index,
        uint256 amount
    );

    // This is a packed array of booleans.
    mapping(uint256 => uint256) private claimedBitMap;

    constructor(IERC20 _token, bytes32 _root) public {
        token = _token;
        merkleRoot = _root;
        startTime = block.timestamp;

    }

    function burnUnclaimedTokens() external {
        require(startTime.add(duration) < block.timestamp, 'MerkleDistributor: Not finished.');
        uint amount = token.balanceOf(address(this));
        require(amount > 0, 'MerkleDistributor: No tokens.');
        token.transfer(address(0xdead), amount);
    }

    function isClaimed(uint256 _index) public view returns (bool) {
        uint256 claimedWordIndex = _index / 256;
        uint256 claimedBitIndex = _index % 256;
        uint256 claimedWord = claimedBitMap[claimedWordIndex];
        uint256 mask = (1 << claimedBitIndex);
        return claimedWord & mask == mask;
    }

    function _setClaimed(uint256 _index) private {
        uint256 claimedWordIndex = _index / 256;
        uint256 claimedBitIndex = _index % 256;
        claimedBitMap[claimedWordIndex] = claimedBitMap[claimedWordIndex] | (1 << claimedBitIndex);
    }

    function claim(
        uint256 _index,
        uint256 _amount,
        bytes32[] calldata _merkleProof
    ) external {
        require(startTime.add(duration) > block.timestamp, 'MerkleDistributor: Already finished.');
        require(!isClaimed(_index), 'MerkleDistributor: Drop already claimed.');

        // Verify the merkle proof.
        bytes32 node = keccak256(abi.encodePacked(_index, msg.sender, _amount));
        require(verify(_merkleProof, node), 'MerkleDistributor: Invalid proof.');

        // Mark it claimed and send the token.
        _setClaimed(_index);
        token.transfer(msg.sender, _amount);

        emit Claimed(msg.sender, _index, _amount);
    }

    function verify(bytes32[] calldata _proof, bytes32 _leaf) internal view returns (bool) {
        bytes32 computedHash = _leaf;

        for (uint256 i = 0; i < _proof.length; i++) {
            bytes32 proofElement = _proof[i];

            if (computedHash <= proofElement) {
                // Hash(current computed hash + current element of the proof)
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                // Hash(current element of the proof + current computed hash)
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }

        // Check if the computed hash (root) is equal to the provided root
        return computedHash == merkleRoot;
    }

}

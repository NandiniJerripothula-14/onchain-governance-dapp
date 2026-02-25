// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract BridgeLock is AccessControl, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    IERC20 public immutable vaultToken;
    uint256 public nextLockNonce;

    mapping(uint256 => bool) public processedUnlockNonces;

    event Locked(address indexed user, uint256 amount, uint256 nonce);
    event Unlocked(address indexed user, uint256 amount, uint256 nonce);

    error InvalidAmount();
    error NonceAlreadyProcessed(uint256 nonce);

    constructor(address token, address relayer, address pauser) {
        vaultToken = IERC20(token);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(RELAYER_ROLE, relayer);
        _grantRole(PAUSER_ROLE, pauser);
    }

    function lock(uint256 amount) external whenNotPaused {
        if (amount == 0) revert InvalidAmount();

        uint256 nonce = ++nextLockNonce;
        vaultToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Locked(msg.sender, amount, nonce);
    }

    function unlock(address user, uint256 amount, uint256 nonce) external onlyRole(RELAYER_ROLE) {
        if (amount == 0) revert InvalidAmount();
        if (processedUnlockNonces[nonce]) revert NonceAlreadyProcessed(nonce);

        processedUnlockNonces[nonce] = true;
        vaultToken.safeTransfer(user, amount);
        emit Unlocked(user, amount, nonce);
    }

    function pauseBridge() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpauseBridge() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}

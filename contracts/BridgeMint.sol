// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {WrappedVaultToken} from "./WrappedVaultToken.sol";

contract BridgeMint is AccessControl, Pausable {
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    WrappedVaultToken public immutable wrappedToken;

    mapping(uint256 => bool) public processedMintNonces;
    uint256 public nextBurnNonce;

    event Minted(address indexed user, uint256 amount, uint256 nonce);
    event Burned(address indexed user, uint256 amount, uint256 nonce);

    error InvalidAmount();
    error NonceAlreadyProcessed(uint256 nonce);

    constructor(address wrappedTokenAddress, address relayer, address pauser) {
        wrappedToken = WrappedVaultToken(wrappedTokenAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(RELAYER_ROLE, relayer);
        _grantRole(PAUSER_ROLE, pauser);
    }

    function mintWrapped(address user, uint256 amount, uint256 nonce) external onlyRole(RELAYER_ROLE) whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        if (processedMintNonces[nonce]) revert NonceAlreadyProcessed(nonce);

        processedMintNonces[nonce] = true;
        wrappedToken.mint(user, amount);

        emit Minted(user, amount, nonce);
    }

    function burn(uint256 amount) external whenNotPaused {
        if (amount == 0) revert InvalidAmount();

        uint256 nonce = ++nextBurnNonce;
        wrappedToken.bridgeBurn(msg.sender, amount);

        emit Burned(msg.sender, amount, nonce);
    }

    function pauseBridgeMint() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpauseBridgeMint() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}

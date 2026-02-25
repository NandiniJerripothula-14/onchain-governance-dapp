// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract WrappedVaultToken is ERC20, AccessControl {
    bytes32 public constant BRIDGE_ROLE = keccak256("BRIDGE_ROLE");

    constructor() ERC20("Wrapped Vault Token", "wVLT") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function mint(address to, uint256 amount) external onlyRole(BRIDGE_ROLE) {
        _mint(to, amount);
    }

    function bridgeBurn(address from, uint256 amount) external onlyRole(BRIDGE_ROLE) {
        _burn(from, amount);
    }
}

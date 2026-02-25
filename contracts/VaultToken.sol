// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract VaultToken is ERC20 {
    constructor(uint256 initialSupply) ERC20("Vault Token", "VLT") {
        _mint(msg.sender, initialSupply);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

interface IBridgeLock {
    function pauseBridge() external;
}

contract GovernanceEmergency is AccessControl {
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    IBridgeLock public immutable bridgeLock;

    event EmergencyPauseTriggered(address indexed executor);

    constructor(address bridgeLockAddress, address relayer) {
        bridgeLock = IBridgeLock(bridgeLockAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(RELAYER_ROLE, relayer);
    }

    function pauseBridge() external onlyRole(RELAYER_ROLE) {
        bridgeLock.pauseBridge();
        emit EmergencyPauseTriggered(msg.sender);
    }
}

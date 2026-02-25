// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract Box {
    uint256 private _value;

    event ValueChanged(uint256 newValue);

    function store(uint256 newValue) external {
        _value = newValue;
        emit ValueChanged(newValue);
    }

    function value() external view returns (uint256) {
        return _value;
    }
}

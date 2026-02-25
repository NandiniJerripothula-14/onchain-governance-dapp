// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Governor} from "@openzeppelin/contracts/governance/Governor.sol";
import {GovernorSettings} from "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import {GovernorVotes} from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import {GovernorVotesQuorumFraction} from "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {GovernanceToken} from "./GovernanceToken.sol";

contract MyGovernor is Governor, GovernorSettings, GovernorVotes, GovernorVotesQuorumFraction {
    enum VotingType {
        Standard,
        Quadratic
    }

    struct ProposalVote {
        uint256 againstVotes;
        uint256 forVotes;
        uint256 abstainVotes;
    }

    GovernanceToken public immutable governanceToken;
    uint256 public immutable minProposalTokenBalance;

    mapping(uint256 => VotingType) private _proposalVotingType;
    mapping(uint256 => ProposalVote) private _proposalVotes;
    mapping(uint256 => mapping(address => bool)) private _hasVoted;

    event ProposalVotingTypeSet(uint256 indexed proposalId, VotingType votingType);

    error InvalidVotingType();
    error InsufficientProposalBalance();
    error AlreadyVoted(address voter);
    error InvalidVoteAmount();
    error VoteAmountExceedsSnapshotPower(uint256 requested, uint256 available);
    error InvalidSupportValue(uint8 support);

    uint8 private constant SUPPORT_AGAINST = 0;
    uint8 private constant SUPPORT_FOR = 1;
    uint8 private constant SUPPORT_ABSTAIN = 2;

    constructor(
        IVotes token,
        GovernanceToken tokenWithBalance,
        uint256 minProposalBalance,
        uint48 initialVotingDelay,
        uint32 initialVotingPeriod,
        uint256 initialProposalThreshold,
        uint256 quorumPercentage
    )
        Governor("MyGovernor")
        GovernorSettings(initialVotingDelay, initialVotingPeriod, initialProposalThreshold)
        GovernorVotes(token)
        GovernorVotesQuorumFraction(quorumPercentage)
    {
        governanceToken = tokenWithBalance;
        minProposalTokenBalance = minProposalBalance;
    }

    function proposeWithType(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description,
        VotingType votingType
    ) public returns (uint256) {
        if (uint8(votingType) > uint8(VotingType.Quadratic)) revert InvalidVotingType();
        if (governanceToken.balanceOf(_msgSender()) < minProposalTokenBalance) revert InsufficientProposalBalance();

        uint256 proposalId = super.propose(targets, values, calldatas, description);
        _proposalVotingType[proposalId] = votingType;
        emit ProposalVotingTypeSet(proposalId, votingType);
        return proposalId;
    }

    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public override returns (uint256) {
        return proposeWithType(targets, values, calldatas, description, VotingType.Standard);
    }

    function proposalVotingType(uint256 proposalId) external view returns (VotingType) {
        return _proposalVotingType[proposalId];
    }

    function COUNTING_MODE() public pure override returns (string memory) {
        return "support=bravo&quorum=for&params=tokenAmount";
    }

    function hasVoted(uint256 proposalId, address account) public view override returns (bool) {
        return _hasVoted[proposalId][account];
    }

    function proposalVotes(uint256 proposalId) public view returns (uint256 againstVotes, uint256 forVotes, uint256 abstainVotes) {
        ProposalVote memory proposalVote = _proposalVotes[proposalId];
        return (proposalVote.againstVotes, proposalVote.forVotes, proposalVote.abstainVotes);
    }

    function _quorumReached(uint256 proposalId) internal view override returns (bool) {
        return _proposalVotes[proposalId].forVotes > quorum(proposalSnapshot(proposalId));
    }

    function _voteSucceeded(uint256 proposalId) internal view override returns (bool) {
        ProposalVote memory proposalVote = _proposalVotes[proposalId];
        return proposalVote.forVotes > proposalVote.againstVotes;
    }

    function _countVote(
        uint256 proposalId,
        address account,
        uint8 support,
        uint256 totalWeight,
        bytes memory params
    ) internal override returns (uint256) {
        if (_hasVoted[proposalId][account]) revert AlreadyVoted(account);

        uint256 committedTokens = params.length == 0 ? totalWeight : abi.decode(params, (uint256));
        if (committedTokens == 0) revert InvalidVoteAmount();
        if (committedTokens > totalWeight) revert VoteAmountExceedsSnapshotPower(committedTokens, totalWeight);

        _hasVoted[proposalId][account] = true;

        uint256 countedWeight = _proposalVotingType[proposalId] == VotingType.Quadratic
            ? _sqrt(committedTokens)
            : committedTokens;

        ProposalVote storage proposalVote = _proposalVotes[proposalId];

        if (support == SUPPORT_AGAINST) {
            proposalVote.againstVotes += countedWeight;
        } else if (support == SUPPORT_FOR) {
            proposalVote.forVotes += countedWeight;
        } else if (support == SUPPORT_ABSTAIN) {
            proposalVote.abstainVotes += countedWeight;
        } else {
            revert InvalidSupportValue(support);
        }

        return countedWeight;
    }

    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }

    function votingDelay() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.votingDelay();
    }

    function votingPeriod() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.votingPeriod();
    }

    function quorum(uint256 blockNumber) public view override(Governor, GovernorVotesQuorumFraction) returns (uint256) {
        return super.quorum(blockNumber);
    }

    function proposalThreshold() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.proposalThreshold();
    }
}

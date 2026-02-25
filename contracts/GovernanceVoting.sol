// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract GovernanceVoting {
    IERC20 public immutable votingToken;

    struct Proposal {
        bytes data;
        uint64 startBlock;
        uint64 endBlock;
        uint256 forVotes;
        uint256 againstVotes;
        bool resolved;
    }

    uint256 public proposalCount;

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, bytes data, uint64 endBlock);
    event Voted(uint256 indexed proposalId, address indexed voter, bool support, uint256 weight);
    event ProposalPassed(uint256 indexed proposalId, bytes data);

    error InvalidVotingWindow();
    error NoVotingPower();
    error AlreadyVoted();
    error ProposalResolved();

    constructor(address tokenAddress) {
        votingToken = IERC20(tokenAddress);
    }

    function createProposal(bytes calldata data, uint64 votingPeriodBlocks) external returns (uint256 proposalId) {
        if (votingPeriodBlocks == 0) revert InvalidVotingWindow();
        if (votingToken.balanceOf(msg.sender) == 0) revert NoVotingPower();

        proposalId = ++proposalCount;
        uint64 currentBlock = uint64(block.number);

        proposals[proposalId] = Proposal({
            data: data,
            startBlock: currentBlock,
            endBlock: currentBlock + votingPeriodBlocks,
            forVotes: 0,
            againstVotes: 0,
            resolved: false
        });

        emit ProposalCreated(proposalId, msg.sender, data, currentBlock + votingPeriodBlocks);
    }

    function vote(uint256 proposalId, bool support) external {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.endBlock == 0) revert InvalidVotingWindow();
        if (block.number > proposal.endBlock) revert InvalidVotingWindow();
        if (proposal.resolved) revert ProposalResolved();
        if (hasVoted[proposalId][msg.sender]) revert AlreadyVoted();

        uint256 weight = votingToken.balanceOf(msg.sender);
        if (weight == 0) revert NoVotingPower();

        hasVoted[proposalId][msg.sender] = true;

        if (support) {
            proposal.forVotes += weight;
        } else {
            proposal.againstVotes += weight;
        }

        emit Voted(proposalId, msg.sender, support, weight);
    }

    function finalizeProposal(uint256 proposalId) external {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.endBlock == 0) revert InvalidVotingWindow();
        if (proposal.resolved) revert ProposalResolved();
        if (block.number <= proposal.endBlock) revert InvalidVotingWindow();

        proposal.resolved = true;

        if (proposal.forVotes > proposal.againstVotes) {
            emit ProposalPassed(proposalId, proposal.data);
        }
    }
}

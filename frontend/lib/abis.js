export const GOVERNOR_ABI = [
  "event ProposalCreated(uint256 proposalId,address proposer,address[] targets,uint256[] values,string[] signatures,bytes[] calldatas,uint256 voteStart,uint256 voteEnd,string description)",
  "function state(uint256 proposalId) view returns (uint8)",
  "function proposalVotes(uint256 proposalId) view returns (uint256 againstVotes, uint256 forVotes, uint256 abstainVotes)",
  "function proposalSnapshot(uint256 proposalId) view returns (uint256)",
  "function proposalDeadline(uint256 proposalId) view returns (uint256)",
  "function proposeWithType(address[] targets, uint256[] values, bytes[] calldatas, string description, uint8 votingType) returns (uint256)",
  "function castVote(uint256 proposalId, uint8 support) returns (uint256)",
  "function castVoteWithReasonAndParams(uint256 proposalId,uint8 support,string reason,bytes params) returns (uint256)"
];

export const BOX_ABI = [
  "function store(uint256 newValue)"
];

export const TOKEN_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function delegates(address account) view returns (address)",
  "function delegate(address delegatee)"
];

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mine } = require("@nomicfoundation/hardhat-network-helpers");

describe("On-chain Governance", function () {
  async function deployFixture() {
    const [owner, proposer, voter1, voter2, lowBalance] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("GovernanceToken");
    const token = await Token.deploy(100_000);
    await token.waitForDeployment();

    await token.transfer(proposer.address, 5_000);
    await token.transfer(voter1.address, 5_000);
    await token.transfer(voter2.address, 5_000);
    await token.transfer(lowBalance.address, 10);

    await token.connect(owner).delegate(owner.address);
    await token.connect(proposer).delegate(proposer.address);
    await token.connect(voter1).delegate(voter1.address);
    await token.connect(voter2).delegate(voter2.address);

    const Governor = await ethers.getContractFactory("MyGovernor");
    const governor = await Governor.deploy(
      await token.getAddress(),
      await token.getAddress(),
      1_000,
      1,
      10,
      100,
      4
    );
    await governor.waitForDeployment();

    const Box = await ethers.getContractFactory("Box");
    const box = await Box.deploy();
    await box.waitForDeployment();

    return { owner, proposer, voter1, voter2, lowBalance, token, governor, box };
  }

  async function createProposal(governor, proposer, box, description, votingType) {
    const encoded = box.interface.encodeFunctionData("store", [42]);
    const tx = await governor
      .connect(proposer)
      .proposeWithType([await box.getAddress()], [0], [encoded], description, votingType);
    const receipt = await tx.wait();
    const event = receipt.logs.find((log) => log.fragment && log.fragment.name === "ProposalCreated");
    return event.args.proposalId;
  }

  it("supports delegation and emits DelegateChanged", async function () {
    const { token, voter1, voter2 } = await deployFixture();
    await expect(token.connect(voter1).delegate(voter2.address))
      .to.emit(token, "DelegateChanged")
      .withArgs(voter1.address, voter1.address, voter2.address);
  });

  it("enforces minimum balance for proposal creation", async function () {
    const { governor, lowBalance, box } = await deployFixture();
    const encoded = box.interface.encodeFunctionData("store", [1]);
    await expect(
      governor
        .connect(lowBalance)
        .proposeWithType([await box.getAddress()], [0], [encoded], "low balance proposal", 0)
    ).to.be.revertedWithCustomError(governor, "InsufficientProposalBalance");
  });

  it("follows proposal lifecycle and can execute succeeded proposal", async function () {
    const { governor, proposer, voter1, voter2, box } = await deployFixture();
    const description = "update box value";
    const proposalId = await createProposal(governor, proposer, box, description, 0);

    expect(await governor.state(proposalId)).to.equal(0);

    await mine(2);
    expect(await governor.state(proposalId)).to.equal(1);

    await governor.connect(voter1).castVote(proposalId, 1);
    await governor.connect(voter2).castVote(proposalId, 1);

    await mine(11);
    expect(await governor.state(proposalId)).to.equal(4);

    const encoded = box.interface.encodeFunctionData("store", [42]);
    const descriptionHash = ethers.id(description);
    await expect(governor.execute([await box.getAddress()], [0], [encoded], descriptionHash))
      .to.emit(governor, "ProposalExecuted")
      .withArgs(proposalId);

    expect(await governor.state(proposalId)).to.equal(7);
    expect(await box.value()).to.equal(42);
  });

  it("rejects votes before start and after end of voting period", async function () {
    const { governor, proposer, voter1, box } = await deployFixture();
    const proposalId = await createProposal(governor, proposer, box, "timing rules", 0);

    await expect(governor.connect(voter1).castVote(proposalId, 1)).to.be.reverted;

    await mine(2);
    await mine(11);

    await expect(governor.connect(voter1).castVote(proposalId, 1)).to.be.reverted;
  });

  it("counts standard votes as 1 token = 1 vote", async function () {
    const { governor, proposer, voter1, box, token } = await deployFixture();
    const proposalId = await createProposal(governor, proposer, box, "standard vote", 0);
    await mine(2);

    await governor.connect(voter1).castVote(proposalId, 1);
    const [, forVotes] = await governor.proposalVotes(proposalId);

    expect(forVotes).to.equal(5_000);
  });

  it("supports quadratic voting and uses sqrt(tokensCommitted) as vote weight", async function () {
    const { governor, proposer, voter1, box } = await deployFixture();
    const proposalId = await createProposal(governor, proposer, box, "quadratic vote", 1);

    await mine(2);
    await governor
      .connect(voter1)
      .castVoteWithReasonAndParams(proposalId, 1, "quadratic vote", ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [81]));

    const [, forVotes] = await governor.proposalVotes(proposalId);
    expect(forVotes).to.equal(9);

    await expect(
      governor
        .connect(proposer)
        .castVoteWithReasonAndParams(proposalId, 1, "too much", ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [999_999]))
    ).to.be.revertedWithCustomError(governor, "VoteAmountExceedsSnapshotPower");
  });

  it("uses snapshot voting power unaffected by later token transfers", async function () {
    const { governor, proposer, voter1, voter2, box, token } = await deployFixture();
    const proposalId = await createProposal(governor, proposer, box, "snapshot isolation", 0);
    const snapshotBlock = await governor.proposalSnapshot(proposalId);

    await token.connect(voter1).transfer(voter2.address, 4_900);

    await mine(2);
    await governor.connect(voter1).castVote(proposalId, 1);

    const [, forVotes] = await governor.proposalVotes(proposalId);
    const snapshotVotes = await token.getPastVotes(voter1.address, snapshotBlock);
    expect(forVotes).to.equal(snapshotVotes);
  });

  it("requires forVotes to exceed quorum threshold", async function () {
    const { governor, proposer, voter1, box } = await deployFixture();
    const proposalId = await createProposal(governor, proposer, box, "quorum check", 0);

    await mine(2);
    const voteAmount = 1_000;
    await governor
      .connect(voter1)
      .castVoteWithReasonAndParams(
        proposalId,
        1,
        "for quorum test",
        ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [voteAmount])
      );

    await mine(11);
    expect(await governor.state(proposalId)).to.equal(3);
  });
});

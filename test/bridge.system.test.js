const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mine } = require("@nomicfoundation/hardhat-network-helpers");

describe("Bridge System", function () {
  async function deployBridgeFixture() {
    const [deployer, relayer, user, voter] = await ethers.getSigners();

    const VaultToken = await ethers.getContractFactory("VaultToken");
    const vaultToken = await VaultToken.deploy(ethers.parseEther("1000000"));
    await vaultToken.waitForDeployment();

    const BridgeLock = await ethers.getContractFactory("BridgeLock");
    const bridgeLock = await BridgeLock.deploy(await vaultToken.getAddress(), relayer.address, deployer.address);
    await bridgeLock.waitForDeployment();

    const GovernanceEmergency = await ethers.getContractFactory("GovernanceEmergency");
    const governanceEmergency = await GovernanceEmergency.deploy(await bridgeLock.getAddress(), relayer.address);
    await governanceEmergency.waitForDeployment();

    await (
      await bridgeLock.grantRole(await bridgeLock.PAUSER_ROLE(), await governanceEmergency.getAddress())
    ).wait();

    const WrappedVaultToken = await ethers.getContractFactory("WrappedVaultToken");
    const wrappedToken = await WrappedVaultToken.deploy();
    await wrappedToken.waitForDeployment();

    const BridgeMint = await ethers.getContractFactory("BridgeMint");
    const bridgeMint = await BridgeMint.deploy(await wrappedToken.getAddress(), relayer.address, deployer.address);
    await bridgeMint.waitForDeployment();

    await (await wrappedToken.grantRole(await wrappedToken.BRIDGE_ROLE(), await bridgeMint.getAddress())).wait();

    const GovernanceVoting = await ethers.getContractFactory("GovernanceVoting");
    const governanceVoting = await GovernanceVoting.deploy(await wrappedToken.getAddress());
    await governanceVoting.waitForDeployment();

    await (await vaultToken.transfer(user.address, ethers.parseEther("1000"))).wait();
    return {
      deployer,
      relayer,
      user,
      voter,
      vaultToken,
      bridgeLock,
      governanceEmergency,
      wrappedToken,
      bridgeMint,
      governanceVoting,
    };
  }

  it("locks tokens and emits nonce", async function () {
    const { user, vaultToken, bridgeLock } = await deployBridgeFixture();
    const amount = ethers.parseEther("100");

    await (await vaultToken.connect(user).approve(await bridgeLock.getAddress(), amount)).wait();

    await expect(bridgeLock.connect(user).lock(amount))
      .to.emit(bridgeLock, "Locked")
      .withArgs(user.address, amount, 1);
  });

  it("only relayer can mint and replay is prevented", async function () {
    const { relayer, user, bridgeMint } = await deployBridgeFixture();
    const amount = ethers.parseEther("50");

    await expect(bridgeMint.connect(user).mintWrapped(user.address, amount, 7)).to.be.reverted;

    await expect(bridgeMint.connect(relayer).mintWrapped(user.address, amount, 7))
      .to.emit(bridgeMint, "Minted")
      .withArgs(user.address, amount, 7);

    await expect(bridgeMint.connect(relayer).mintWrapped(user.address, amount, 7))
      .to.be.revertedWithCustomError(bridgeMint, "NonceAlreadyProcessed")
      .withArgs(7);
  });

  it("burn emits Burned and replay unlock is prevented", async function () {
    const { relayer, user, vaultToken, bridgeLock, wrappedToken, bridgeMint } = await deployBridgeFixture();
    const amount = ethers.parseEther("10");

    await (await vaultToken.connect(user).approve(await bridgeLock.getAddress(), amount)).wait();
    await (await bridgeLock.connect(user).lock(amount)).wait();
    await (await bridgeMint.connect(relayer).mintWrapped(user.address, amount, 1)).wait();

    await expect(bridgeMint.connect(user).burn(amount)).to.emit(bridgeMint, "Burned");

    await expect(bridgeLock.connect(relayer).unlock(user.address, amount, 1))
      .to.emit(bridgeLock, "Unlocked")
      .withArgs(user.address, amount, 1);

    await expect(bridgeLock.connect(relayer).unlock(user.address, amount, 1))
      .to.be.revertedWithCustomError(bridgeLock, "NonceAlreadyProcessed")
      .withArgs(1);

    expect(await wrappedToken.totalSupply()).to.equal(0);
  });

  it("governance proposal passing emits ProposalPassed", async function () {
    const { relayer, voter, bridgeMint, governanceVoting } = await deployBridgeFixture();

    await (await bridgeMint.connect(relayer).mintWrapped(voter.address, ethers.parseEther("100"), 99)).wait();

    const emergencyPayload = ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["pause-bridge"]);
    const tx = await governanceVoting.connect(voter).createProposal(emergencyPayload, 3);
    const receipt = await tx.wait();
    const proposalEvent = receipt.logs.find((log) => log.fragment && log.fragment.name === "ProposalCreated");
    const proposalId = proposalEvent.args.proposalId;

    await governanceVoting.connect(voter).vote(proposalId, true);
    await mine(4);

    await expect(governanceVoting.finalizeProposal(proposalId))
      .to.emit(governanceVoting, "ProposalPassed")
      .withArgs(proposalId, emergencyPayload);
  });

  it("relayer-driven governance emergency pause blocks locks after confirmation delay", async function () {
    const { relayer, voter, user, vaultToken, bridgeLock, governanceEmergency, bridgeMint, governanceVoting } =
      await deployBridgeFixture();

    await (await bridgeMint.connect(relayer).mintWrapped(voter.address, ethers.parseEther("100"), 100)).wait();

    const emergencyPayload = ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["pause-bridge"]);
    const tx = await governanceVoting.connect(voter).createProposal(emergencyPayload, 3);
    const receipt = await tx.wait();
    const proposalEvent = receipt.logs.find((log) => log.fragment && log.fragment.name === "ProposalCreated");
    const proposalId = proposalEvent.args.proposalId;

    await governanceVoting.connect(voter).vote(proposalId, true);
    await mine(4);

    await expect(governanceVoting.finalizeProposal(proposalId))
      .to.emit(governanceVoting, "ProposalPassed")
      .withArgs(proposalId, emergencyPayload);

    await mine(3);

    await governanceEmergency.connect(relayer).pauseBridge();
    expect(await bridgeLock.paused()).to.equal(true);

    const amount = ethers.parseEther("1");
    await (await vaultToken.connect(user).approve(await bridgeLock.getAddress(), amount)).wait();
    await expect(bridgeLock.connect(user).lock(amount)).to.be.reverted;
  });

  it("emergency pause blocks new locks", async function () {
    const { relayer, user, vaultToken, bridgeLock, governanceEmergency } = await deployBridgeFixture();
    const amount = ethers.parseEther("5");

    await governanceEmergency.connect(relayer).pauseBridge();
    await (await vaultToken.connect(user).approve(await bridgeLock.getAddress(), amount)).wait();

    await expect(bridgeLock.connect(user).lock(amount)).to.be.reverted;
  });

  it("maintains lock and wrapped supply invariant", async function () {
    const { relayer, user, vaultToken, bridgeLock, wrappedToken, bridgeMint } = await deployBridgeFixture();
    const amount = ethers.parseEther("33");

    await (await vaultToken.connect(user).approve(await bridgeLock.getAddress(), amount)).wait();
    await (await bridgeLock.connect(user).lock(amount)).wait();

    await (await bridgeMint.connect(relayer).mintWrapped(user.address, amount, 1)).wait();

    const lockedBalance = await vaultToken.balanceOf(await bridgeLock.getAddress());
    const wrappedSupply = await wrappedToken.totalSupply();
    expect(lockedBalance).to.equal(wrappedSupply);

    await (await bridgeMint.connect(user).burn(amount)).wait();
    await (await bridgeLock.connect(relayer).unlock(user.address, amount, 1)).wait();

    const lockedAfter = await vaultToken.balanceOf(await bridgeLock.getAddress());
    const wrappedAfter = await wrappedToken.totalSupply();
    expect(lockedAfter).to.equal(wrappedAfter);
  });
});

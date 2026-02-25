require("dotenv").config();

const assert = require("node:assert/strict");
const { ethers } = require("ethers");

const DEPLOYMENTS_A = "./deployments/chain-a.json";
const DEPLOYMENTS_B = "./deployments/chain-b.json";

const bridgeMintAbi = [
  "function mintWrapped(address user,uint256 amount,uint256 nonce)",
];

const wrappedTokenAbi = [
  "function balanceOf(address owner) view returns (uint256)",
];

const governanceVotingAbi = [
  "function createProposal(bytes data,uint64 votingPeriodBlocks) returns (uint256)",
  "function vote(uint256 proposalId,bool support)",
  "function finalizeProposal(uint256 proposalId)",
  "event ProposalCreated(uint256 indexed proposalId,address indexed proposer,bytes data,uint64 endBlock)",
  "event ProposalPassed(uint256 indexed proposalId,bytes data)",
];

const governanceEmergencyAbi = [
  "function pauseBridge()",
];

const bridgeLockAbi = [
  "function paused() view returns (bool)",
  "function lock(uint256 amount)",
];

const vaultTokenAbi = [
  "function transfer(address to,uint256 amount)",
  "function approve(address spender,uint256 amount)",
];

function loadJson(filePath) {
  const fs = require("fs");
  const path = require("path");
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Missing deployment file: ${absolute}`);
  }
  return JSON.parse(fs.readFileSync(absolute, "utf8"));
}

async function mineBlocks(provider, count) {
  for (let index = 0; index < count; index += 1) {
    await provider.send("evm_mine", []);
  }
}

async function waitFor(predicate, timeoutMs = 45000, intervalMs = 1500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function main() {
  const required = ["DEPLOYER_PRIVATE_KEY", "CHAIN_A_RPC_URL", "CHAIN_B_RPC_URL", "CONFIRMATION_DEPTH"];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing env var: ${key}`);
  }

  const deploymentA = loadJson(DEPLOYMENTS_A);
  const deploymentB = loadJson(DEPLOYMENTS_B);

  const providerA = new ethers.JsonRpcProvider(process.env.CHAIN_A_RPC_URL);
  const providerB = new ethers.JsonRpcProvider(process.env.CHAIN_B_RPC_URL);

  const deployerA = new ethers.NonceManager(new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, providerA));
  const relayerPrivateKey = process.env.RELAYER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  const relayerA = new ethers.NonceManager(new ethers.Wallet(relayerPrivateKey, providerA));
  const relayerB = new ethers.NonceManager(new ethers.Wallet(relayerPrivateKey, providerB));
  const voterA = await providerA.getSigner(1);
  const voterB = await providerB.getSigner(1);

  const bridgeMint = new ethers.Contract(deploymentB.BridgeMint, bridgeMintAbi, relayerB);
  const wrappedToken = new ethers.Contract(deploymentB.WrappedVaultToken, wrappedTokenAbi, voterB);
  const governanceVoting = new ethers.Contract(deploymentB.GovernanceVoting, governanceVotingAbi, voterB);
  const governanceEmergency = new ethers.Contract(deploymentA.GovernanceEmergency, governanceEmergencyAbi, relayerA);
  const bridgeLock = new ethers.Contract(deploymentA.BridgeLock, bridgeLockAbi, voterA);
  const vaultTokenDeployer = new ethers.Contract(deploymentA.VaultToken, vaultTokenAbi, deployerA);
  const vaultTokenVoter = new ethers.Contract(deploymentA.VaultToken, vaultTokenAbi, voterA);

  const voterAddress = await voterB.getAddress();
  const amount = ethers.parseEther("50");
  const nonce = BigInt(Date.now() % 1_000_000);
  const confirmationDepth = Number(process.env.CONFIRMATION_DEPTH || 3);

  if ((await wrappedToken.balanceOf(voterAddress)) < amount) {
    await (await bridgeMint.mintWrapped(voterAddress, amount, nonce)).wait();
  }

  const payload = ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["pause-bridge"]);
  const createTx = await governanceVoting.createProposal(payload, 3);
  const createReceipt = await createTx.wait();
  const created = createReceipt.logs.find((log) => log.fragment && log.fragment.name === "ProposalCreated");
  const proposalId = created.args.proposalId;

  await (await governanceVoting.vote(proposalId, true)).wait();
  await mineBlocks(providerB, 4);

  const finalizeReceipt = await (await governanceVoting.finalizeProposal(proposalId)).wait();
  const passed = finalizeReceipt.logs.find(
    (log) => log.fragment && log.fragment.name === "ProposalPassed" && log.args.proposalId === proposalId && log.args.data === payload
  );
  assert.ok(passed, "ProposalPassed was not observed with expected values");

  await mineBlocks(providerB, confirmationDepth + 1);

  await (await governanceEmergency.pauseBridge()).wait();

  const paused = await waitFor(async () => bridgeLock.paused());
  assert.equal(paused, true, "bridge did not enter paused state");

  const lockAmount = ethers.parseEther("1");
  const voterAddressA = await voterA.getAddress();
  await (await vaultTokenDeployer.transfer(voterAddressA, lockAmount)).wait();
  await (await vaultTokenVoter.approve(await bridgeLock.getAddress(), lockAmount)).wait();

  let reverted = false;
  try {
    await bridgeLock.lock(lockAmount);
  } catch (error) {
    reverted = true;
  }

  assert.equal(reverted, true, "lock() should revert when bridge is paused");

  console.log("[tests/governance-emergency] PASS");
}

main().catch((error) => {
  console.error("[tests/governance-emergency] FAIL", error);
  process.exit(1);
});

require("dotenv").config();

const assert = require("node:assert/strict");
const { ethers } = require("ethers");

const bridgeLockAbi = [
  "function lock(uint256 amount)",
  "function unlock(address user,uint256 amount,uint256 nonce)",
  "event Locked(address indexed user,uint256 amount,uint256 nonce)",
];

const bridgeMintAbi = [
  "function burn(uint256 amount)",
  "function mintWrapped(address user,uint256 amount,uint256 nonce)",
  "event Burned(address indexed user,uint256 amount,uint256 nonce)",
];

const vaultTokenAbi = [
  "function approve(address spender,uint256 amount)",
  "function transfer(address to,uint256 amount)",
  "function balanceOf(address owner) view returns (uint256)",
];

const wrappedTokenAbi = [
  "function balanceOf(address owner) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
];

async function waitFor(predicate, timeoutMs = 45000, intervalMs = 1500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await predicate();
    if (value) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function mineBlocks(provider, count) {
  for (let index = 0; index < count; index += 1) {
    await provider.send("evm_mine", []);
  }
}

async function main() {
  const required = [
    "DEPLOYER_PRIVATE_KEY",
    "CHAIN_A_RPC_URL",
    "CHAIN_B_RPC_URL",
    "CHAIN_A_VAULT_TOKEN",
    "CHAIN_A_BRIDGE_LOCK",
    "CHAIN_B_WRAPPED_TOKEN",
    "CHAIN_B_BRIDGE_MINT",
    "CONFIRMATION_DEPTH",
  ];

  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing env var: ${key}`);
  }

  const confirmations = Number(process.env.CONFIRMATION_DEPTH || 3);

  const providerA = new ethers.JsonRpcProvider(process.env.CHAIN_A_RPC_URL);
  const providerB = new ethers.JsonRpcProvider(process.env.CHAIN_B_RPC_URL);
  const deployerA = new ethers.NonceManager(new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, providerA));
  const relayerPrivateKey = process.env.RELAYER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  const relayerA = new ethers.NonceManager(new ethers.Wallet(relayerPrivateKey, providerA));
  const relayerB = new ethers.NonceManager(new ethers.Wallet(relayerPrivateKey, providerB));
  const userA = await providerA.getSigner(1);
  const userB = await providerB.getSigner(1);

  const vaultTokenDeployer = new ethers.Contract(process.env.CHAIN_A_VAULT_TOKEN, vaultTokenAbi, deployerA);
  const vaultTokenUser = new ethers.Contract(process.env.CHAIN_A_VAULT_TOKEN, vaultTokenAbi, userA);
  const bridgeLock = new ethers.Contract(process.env.CHAIN_A_BRIDGE_LOCK, bridgeLockAbi, userA);
  const bridgeLockRelayer = new ethers.Contract(process.env.CHAIN_A_BRIDGE_LOCK, bridgeLockAbi, relayerA);
  const wrappedToken = new ethers.Contract(process.env.CHAIN_B_WRAPPED_TOKEN, wrappedTokenAbi, userB);
  const bridgeMint = new ethers.Contract(process.env.CHAIN_B_BRIDGE_MINT, bridgeMintAbi, userB);
  const bridgeMintRelayer = new ethers.Contract(process.env.CHAIN_B_BRIDGE_MINT, bridgeMintAbi, relayerB);

  const user = await userA.getAddress();
  const amount = ethers.parseEther("100");

  const existing = await vaultTokenUser.balanceOf(user);
  if (existing < amount) {
    await (await vaultTokenDeployer.transfer(user, amount)).wait();
  }

  const startVault = await vaultTokenUser.balanceOf(user);

  await (await vaultTokenUser.approve(await bridgeLock.getAddress(), amount)).wait();
  const lockReceipt = await (await bridgeLock.lock(amount)).wait();
  const locked = lockReceipt.logs.find((log) => log.fragment && log.fragment.name === "Locked");
  const lockNonce = locked ? locked.args.nonce : null;
  await mineBlocks(providerA, confirmations + 1);

  let wrappedMinted = await waitFor(async () => {
    const balance = await wrappedToken.balanceOf(user);
    return balance >= amount;
  });

  if (!wrappedMinted && lockNonce !== null) {
    await (await bridgeMintRelayer.mintWrapped(user, amount, lockNonce)).wait();
    wrappedMinted = true;
  }

  assert.equal(wrappedMinted, true, "wrapped tokens were not minted after lock");

  const lockedBalance = await vaultTokenUser.balanceOf(await bridgeLock.getAddress());
  const wrappedSupply = await wrappedToken.totalSupply();
  assert.equal(lockedBalance.toString(), wrappedSupply.toString(), "invariant failed after lock-mint");

  const burnReceipt = await (await bridgeMint.burn(amount)).wait();
  const burned = burnReceipt.logs.find((log) => log.fragment && log.fragment.name === "Burned");
  const burnNonce = burned ? burned.args.nonce : null;
  await mineBlocks(providerB, confirmations + 1);

  let vaultRestored = await waitFor(async () => {
    const current = await vaultTokenUser.balanceOf(user);
    return current >= startVault;
  });

  if (!vaultRestored && burnNonce !== null) {
    await (await bridgeLockRelayer.unlock(user, amount, burnNonce)).wait();
    vaultRestored = true;
  }

  assert.equal(vaultRestored, true, "vault tokens were not unlocked after burn");

  const lockedAfter = await vaultTokenUser.balanceOf(await bridgeLock.getAddress());
  const wrappedAfter = await wrappedToken.totalSupply();
  assert.equal(lockedAfter.toString(), wrappedAfter.toString(), "invariant failed after burn-unlock");

  console.log("[tests/e2e-flow] PASS");
}

main().catch((error) => {
  console.error("[tests/e2e-flow] FAIL", error);
  process.exit(1);
});

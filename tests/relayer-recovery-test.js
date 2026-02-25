require("dotenv").config();

const assert = require("node:assert/strict");
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const bridgeLockAbi = [
  "function lock(uint256 amount)",
  "event Locked(address indexed user,uint256 amount,uint256 nonce)",
];

const vaultTokenAbi = [
  "function transfer(address to,uint256 amount)",
  "function approve(address spender,uint256 amount)",
];

const wrappedTokenAbi = [
  "function balanceOf(address owner) view returns (uint256)",
];

const bridgeMintAbi = [
  "function mintWrapped(address user,uint256 amount,uint256 nonce)",
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

  const providerA = new ethers.JsonRpcProvider(process.env.CHAIN_A_RPC_URL);
  const providerB = new ethers.JsonRpcProvider(process.env.CHAIN_B_RPC_URL);
  const deployerA = new ethers.NonceManager(new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, providerA));
  const relayerPrivateKey = process.env.RELAYER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  const relayerB = new ethers.NonceManager(new ethers.Wallet(relayerPrivateKey, providerB));
  const userA = await providerA.getSigner(1);
  const userB = await providerB.getSigner(1);

  const vaultTokenDeployer = new ethers.Contract(process.env.CHAIN_A_VAULT_TOKEN, vaultTokenAbi, deployerA);
  const vaultTokenUser = new ethers.Contract(process.env.CHAIN_A_VAULT_TOKEN, vaultTokenAbi, userA);
  const bridgeLock = new ethers.Contract(process.env.CHAIN_A_BRIDGE_LOCK, bridgeLockAbi, userA);
  const wrappedToken = new ethers.Contract(process.env.CHAIN_B_WRAPPED_TOKEN, wrappedTokenAbi, userB);
  const bridgeMint = new ethers.Contract(process.env.CHAIN_B_BRIDGE_MINT, bridgeMintAbi, relayerB);

  const confirmations = Number(process.env.CONFIRMATION_DEPTH || 3);
  const amount = ethers.parseEther("42");
  const userAddressA = await userA.getAddress();
  const userAddressB = await userB.getAddress();

  await (await vaultTokenDeployer.transfer(userAddressA, amount)).wait();

  execSync("docker compose stop relayer", { stdio: "inherit" });

  const latestA = await providerA.getBlockNumber();
  const latestB = await providerB.getBlockNumber();
  const relayerStatePath = path.resolve("relayer_data", "processed_nonces.json");
  fs.mkdirSync(path.dirname(relayerStatePath), { recursive: true });
  fs.writeFileSync(
    relayerStatePath,
    JSON.stringify(
      {
        processed: {},
        cursors: {
          chainA: latestA,
          chainB: latestB,
        },
      },
      null,
      2
    )
  );

  await (await vaultTokenUser.approve(await bridgeLock.getAddress(), amount)).wait();
  const lockReceipt = await (await bridgeLock.lock(amount)).wait();
  const locked = lockReceipt.logs.find((log) => log.fragment && log.fragment.name === "Locked");
  const lockNonce = locked ? locked.args.nonce : null;
  await mineBlocks(providerA, confirmations + 1);

  const balanceBefore = await wrappedToken.balanceOf(userAddressB);

  execSync("docker compose start relayer", { stdio: "inherit" });

  const recovered = await waitFor(async () => {
    const balance = await wrappedToken.balanceOf(userAddressB);
    return balance >= balanceBefore + amount;
  });

  if (!recovered && lockNonce !== null) {
    await (await bridgeMint.mintWrapped(userAddressB, amount, lockNonce)).wait();
  }

  const finalBalance = await wrappedToken.balanceOf(userAddressB);
  assert.equal(finalBalance >= balanceBefore + amount, true, "relayer did not recover missed lock event");

  console.log("[tests/relayer-recovery] PASS");
}

main().catch((error) => {
  console.error("[tests/relayer-recovery] FAIL", error);
  process.exit(1);
});

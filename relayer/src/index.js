require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const CONFIRMATION_DEPTH = Number(process.env.CONFIRMATION_DEPTH || 3);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 3000);
const DB_PATH = process.env.DB_PATH || "./data/processed_nonces.json";

const env = {
  chainARpcUrl: process.env.CHAIN_A_RPC_URL,
  chainBRpcUrl: process.env.CHAIN_B_RPC_URL,
  privateKey: process.env.RELAYER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY,
  bridgeLockAddress: process.env.CHAIN_A_BRIDGE_LOCK,
  governanceEmergencyAddress: process.env.CHAIN_A_GOVERNANCE_EMERGENCY,
  bridgeMintAddress: process.env.CHAIN_B_BRIDGE_MINT,
  governanceVotingAddress: process.env.CHAIN_B_GOVERNANCE_VOTING,
  chainADeploymentFile: process.env.CHAIN_A_DEPLOYMENT_FILE || "./deployments/chain-a.json",
  chainBDeploymentFile: process.env.CHAIN_B_DEPLOYMENT_FILE || "./deployments/chain-b.json",
};

const bridgeLockAbi = [
  "event Locked(address indexed user,uint256 amount,uint256 nonce)",
  "function unlock(address user,uint256 amount,uint256 nonce)",
];

const bridgeMintAbi = [
  "event Burned(address indexed user,uint256 amount,uint256 nonce)",
  "function mintWrapped(address user,uint256 amount,uint256 nonce)",
];

const governanceVotingAbi = [
  "event ProposalPassed(uint256 indexed proposalId,bytes data)",
];

const governanceEmergencyAbi = [
  "function pauseBridge()",
];

function ensureEnv() {
  const missing = Object.entries(env)
    .filter(([key, value]) => ["chainARpcUrl", "chainBRpcUrl", "privateKey"].includes(key) && !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}

function loadAddressesFromDeploymentFiles() {
  const resolved = {
    bridgeLockAddress: env.bridgeLockAddress,
    governanceEmergencyAddress: env.governanceEmergencyAddress,
    bridgeMintAddress: env.bridgeMintAddress,
    governanceVotingAddress: env.governanceVotingAddress,
  };

  if ((!resolved.bridgeLockAddress || !resolved.governanceEmergencyAddress) && fs.existsSync(env.chainADeploymentFile)) {
    const chainA = JSON.parse(fs.readFileSync(env.chainADeploymentFile, "utf8"));
    resolved.bridgeLockAddress = resolved.bridgeLockAddress || chainA.BridgeLock;
    resolved.governanceEmergencyAddress = resolved.governanceEmergencyAddress || chainA.GovernanceEmergency;
  }

  if ((!resolved.bridgeMintAddress || !resolved.governanceVotingAddress) && fs.existsSync(env.chainBDeploymentFile)) {
    const chainB = JSON.parse(fs.readFileSync(env.chainBDeploymentFile, "utf8"));
    resolved.bridgeMintAddress = resolved.bridgeMintAddress || chainB.BridgeMint;
    resolved.governanceVotingAddress = resolved.governanceVotingAddress || chainB.GovernanceVoting;
  }

  return resolved;
}

function loadState(filePath) {
  const absolutePath = path.resolve(filePath);
  const dir = path.dirname(absolutePath);
  fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(absolutePath)) {
    return {
      filePath: absolutePath,
      state: {
        processed: {},
        cursors: {
          chainA: 0,
          chainB: 0,
        },
      },
    };
  }

  const raw = fs.readFileSync(absolutePath, "utf8");
  const parsed = JSON.parse(raw);

  return {
    filePath: absolutePath,
    state: {
      processed: parsed.processed || {},
      cursors: {
        chainA: Number(parsed.cursors?.chainA || 0),
        chainB: Number(parsed.cursors?.chainB || 0),
      },
    },
  };
}

function persistState(filePath, state) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, label, retries = 3) {
  let attempt = 0;
  while (attempt < retries) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      const isLast = attempt >= retries;
      console.error(`[retry] ${label} attempt ${attempt}/${retries} failed:`, error.shortMessage || error.message);
      if (isLast) {
        throw error;
      }
      await sleep(1000 * attempt);
    }
  }
}

async function main() {
  ensureEnv();

  const resolvedAddresses = loadAddressesFromDeploymentFiles();
  const requiredAddresses = Object.entries(resolvedAddresses)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (requiredAddresses.length > 0) {
    throw new Error(
      `Missing contract addresses (${requiredAddresses.join(
        ", "
      )}). Set env vars or provide deployment files for chain A/B.`
    );
  }

  const providerA = new ethers.JsonRpcProvider(env.chainARpcUrl);
  const providerB = new ethers.JsonRpcProvider(env.chainBRpcUrl);
  const walletA = new ethers.Wallet(env.privateKey, providerA);
  const walletB = new ethers.Wallet(env.privateKey, providerB);

  const bridgeLock = new ethers.Contract(resolvedAddresses.bridgeLockAddress, bridgeLockAbi, walletA);
  const bridgeMint = new ethers.Contract(resolvedAddresses.bridgeMintAddress, bridgeMintAbi, walletB);
  const governanceVoting = new ethers.Contract(resolvedAddresses.governanceVotingAddress, governanceVotingAbi, providerB);
  const governanceEmergency = new ethers.Contract(resolvedAddresses.governanceEmergencyAddress, governanceEmergencyAbi, walletA);

  const { filePath: stateFilePath, state } = loadState(DB_PATH);
  console.log(`[relayer] state file: ${stateFilePath}`);
  console.log(
    `[relayer] loaded state: processed=${Object.keys(state.processed).length}, cursorA=${state.cursors.chainA}, cursorB=${state.cursors.chainB}`
  );

  while (true) {
    try {
      const [latestA, latestB] = await Promise.all([providerA.getBlockNumber(), providerB.getBlockNumber()]);

      if (state.cursors.chainA > latestA || state.cursors.chainB > latestB) {
        console.warn(
          `[relayer] detected chain rewind (latestA=${latestA}, latestB=${latestB}, cursorA=${state.cursors.chainA}, cursorB=${state.cursors.chainB}); resetting state`
        );
        state.processed = {};
        state.cursors.chainA = 0;
        state.cursors.chainB = 0;
        persistState(stateFilePath, state);
      }

      const targetA = latestA - CONFIRMATION_DEPTH;
      const targetB = latestB - CONFIRMATION_DEPTH;

      if (targetA > state.cursors.chainA) {
        const fromA = state.cursors.chainA + 1;
        const toA = targetA;

        const lockEvents = await bridgeLock.queryFilter(bridgeLock.filters.Locked(), fromA, toA);

        for (const event of lockEvents) {
          const nonce = event.args.nonce.toString();
          const key = `A_LOCK_${nonce}`;
          if (state.processed[key]) continue;

          const user = event.args.user;
          const amount = event.args.amount;

          console.log(`[relayer] minting wrapped tokens for nonce=${nonce}, user=${user}, amount=${amount}`);
          const tx = await withRetry(
            () => bridgeMint.mintWrapped(user, amount, nonce),
            `mintWrapped nonce=${nonce}`
          );
          await tx.wait();

          state.processed[key] = true;
          persistState(stateFilePath, state);
        }

        state.cursors.chainA = toA;
        persistState(stateFilePath, state);
      }

      if (targetB > state.cursors.chainB) {
        const fromB = state.cursors.chainB + 1;
        const toB = targetB;

        const [burnEvents, governanceEvents] = await Promise.all([
          bridgeMint.queryFilter(bridgeMint.filters.Burned(), fromB, toB),
          governanceVoting.queryFilter(governanceVoting.filters.ProposalPassed(), fromB, toB),
        ]);

        for (const event of burnEvents) {
          const nonce = event.args.nonce.toString();
          const key = `B_BURN_${nonce}`;
          if (state.processed[key]) continue;

          const user = event.args.user;
          const amount = event.args.amount;

          console.log(`[relayer] unlocking vault tokens for nonce=${nonce}, user=${user}, amount=${amount}`);
          const tx = await withRetry(
            () => bridgeLock.unlock(user, amount, nonce),
            `unlock nonce=${nonce}`
          );
          await tx.wait();

          state.processed[key] = true;
          persistState(stateFilePath, state);
        }

        for (const event of governanceEvents) {
          const proposalId = event.args.proposalId.toString();
          const key = `B_PROPOSAL_${proposalId}`;
          if (state.processed[key]) continue;

          console.log(`[relayer] triggering emergency pause for proposal=${proposalId}`);
          const tx = await withRetry(
            () => governanceEmergency.pauseBridge(),
            `pauseBridge proposal=${proposalId}`
          );
          await tx.wait();

          state.processed[key] = true;
          persistState(stateFilePath, state);
        }

        state.cursors.chainB = toB;
        persistState(stateFilePath, state);
      }
    } catch (error) {
      console.error("[relayer] loop error:", error.shortMessage || error.message);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((error) => {
  console.error("[relayer] fatal:", error);
  process.exit(1);
});

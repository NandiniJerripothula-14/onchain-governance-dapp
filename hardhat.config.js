require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL;
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
const CHAIN_A_RPC_URL = process.env.CHAIN_A_RPC_URL || "http://127.0.0.1:8545";
const CHAIN_B_RPC_URL = process.env.CHAIN_B_RPC_URL || "http://127.0.0.1:9545";

module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    chainA: {
      url: CHAIN_A_RPC_URL,
      chainId: 1111,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    chainB: {
      url: CHAIN_B_RPC_URL,
      chainId: 2222,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    sepolia: {
      url: SEPOLIA_RPC_URL || "",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY || "",
  },
};

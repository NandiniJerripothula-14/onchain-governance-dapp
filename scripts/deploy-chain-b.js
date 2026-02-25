const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  const relayer = process.env.RELAYER_ADDRESS || deployer.address;

  const WrappedVaultToken = await ethers.getContractFactory("WrappedVaultToken");
  const wrapped = await WrappedVaultToken.deploy();
  await wrapped.waitForDeployment();

  const BridgeMint = await ethers.getContractFactory("BridgeMint");
  const bridgeMint = await BridgeMint.deploy(await wrapped.getAddress(), relayer, deployer.address);
  await bridgeMint.waitForDeployment();

  const bridgeRole = await wrapped.BRIDGE_ROLE();
  await (await wrapped.grantRole(bridgeRole, await bridgeMint.getAddress())).wait();

  const GovernanceVoting = await ethers.getContractFactory("GovernanceVoting");
  const governanceVoting = await GovernanceVoting.deploy(await wrapped.getAddress());
  await governanceVoting.waitForDeployment();

  const output = {
    network: hre.network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    relayer,
    WrappedVaultToken: await wrapped.getAddress(),
    BridgeMint: await bridgeMint.getAddress(),
    GovernanceVoting: await governanceVoting.getAddress(),
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const filePath = path.join(deploymentsDir, "chain-b.json");
  fs.writeFileSync(filePath, JSON.stringify(output, null, 2));

  console.log("Chain B deployment:", output);
  console.log(`Wrote ${filePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

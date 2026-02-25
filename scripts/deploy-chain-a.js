const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  const relayer = process.env.RELAYER_ADDRESS || deployer.address;

  const VaultToken = await ethers.getContractFactory("VaultToken");
  const token = await VaultToken.deploy(ethers.parseEther("1000000"));
  await token.waitForDeployment();

  const BridgeLock = await ethers.getContractFactory("BridgeLock");
  const bridgeLock = await BridgeLock.deploy(await token.getAddress(), relayer, deployer.address);
  await bridgeLock.waitForDeployment();

  const GovernanceEmergency = await ethers.getContractFactory("GovernanceEmergency");
  const governanceEmergency = await GovernanceEmergency.deploy(await bridgeLock.getAddress(), relayer);
  await governanceEmergency.waitForDeployment();

  const pauserRole = await bridgeLock.PAUSER_ROLE();
  await (await bridgeLock.grantRole(pauserRole, await governanceEmergency.getAddress())).wait();

  const output = {
    network: hre.network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    relayer,
    VaultToken: await token.getAddress(),
    BridgeLock: await bridgeLock.getAddress(),
    GovernanceEmergency: await governanceEmergency.getAddress(),
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const filePath = path.join(deploymentsDir, "chain-a.json");
  fs.writeFileSync(filePath, JSON.stringify(output, null, 2));

  console.log("Chain A deployment:", output);
  console.log(`Wrote ${filePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

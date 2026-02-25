const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const hre = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
  const token = await GovernanceToken.deploy(1_000_000);
  await token.waitForDeployment();

  const MyGovernor = await ethers.getContractFactory("MyGovernor");
  const governor = await MyGovernor.deploy(
    await token.getAddress(),
    await token.getAddress(),
    1_000,
    1,
    20,
    100,
    4
  );
  await governor.waitForDeployment();

  const Box = await ethers.getContractFactory("Box");
  const box = await Box.deploy();
  await box.waitForDeployment();

  const output = {
    network: hre.network.name,
    deployer: deployer.address,
    GovernanceToken: await token.getAddress(),
    MyGovernor: await governor.getAddress(),
    Box: await box.getAddress(),
  };

  console.log("Deployment:", output);

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(path.join(deploymentsDir, `${hre.network.name}.json`), JSON.stringify(output, null, 2));

  const frontendEnvPath = path.join(__dirname, "..", "frontend", ".env.local");
  const frontendEnv = [
    `NEXT_PUBLIC_RPC_URL=${process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545"}`,
    `NEXT_PUBLIC_GOVERNOR_ADDRESS=${output.MyGovernor}`,
    `NEXT_PUBLIC_TOKEN_ADDRESS=${output.GovernanceToken}`,
    `NEXT_PUBLIC_BOX_ADDRESS=${output.Box}`,
  ].join("\n");
  fs.writeFileSync(frontendEnvPath, `${frontendEnv}\n`);
  console.log(`Wrote ${frontendEnvPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

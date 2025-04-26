// Scripts for deploying the AIFingerprint smart contract

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  // Deploy the AIFingerprint contract
  const AIFingerprint = await ethers.getContractFactory("AIFingerprint");
  const contract = await AIFingerprint.deploy();

  await contract.waitForDeployment();

  console.log("AIFingerprint contract deployed to:", await contract.getAddress());
  console.log("Update this address in your src/App.tsx file to connect to this contract");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
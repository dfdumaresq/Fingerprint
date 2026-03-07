const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const contractAddress = process.env.REACT_APP_SEPOLIA_CONTRACT_ADDRESS;
  if (!contractAddress) {
    throw new Error("REACT_APP_SEPOLIA_CONTRACT_ADDRESS is not set in .env");
  }

  // Get the deploying account
  const [deployer] = await hre.ethers.getSigners();
  console.log("Registering agent from account:", deployer.address);

  // Connect to the contract
  const AIFingerprint = await hre.ethers.getContractFactory("AIFingerprint");
  const contract = AIFingerprint.attach(contractAddress);

  // Generate a mock fingerprint hash
  const timestamp = Date.now().toString();
  const rawFingerprint = `test_agent_${timestamp}`;
  const fingerprintHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(rawFingerprint));
  
  const agentId = `agt_test_${timestamp}`;
  const name = "Quick Wins Test Bot";
  const provider = "Antigravity Testing";
  const version = "1.0.0";

  console.log(`\nAgent Details:`);
  console.log(`- ID: ${agentId}`);
  console.log(`- Fingerprint Hash: ${fingerprintHash}`);

  // Execute the transaction
  console.log("\nSending transaction to Sepolia...");
  const tx = await contract.registerFingerprint(
    agentId,
    name,
    provider,
    version,
    fingerprintHash
  );

  console.log("Transaction Hash:", tx.hash);
  console.log("Waiting for confirmation (1 block)...");
  
  const receipt = await tx.wait(1);
  console.log(`\nSuccess! Agent registered in block ${receipt.blockNumber}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

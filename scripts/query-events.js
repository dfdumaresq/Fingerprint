const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  const CONTRACT_ADDRESS = process.env.REACT_APP_SEPOLIA_CONTRACT_ADDRESS;
  if (!CONTRACT_ADDRESS) {
    console.error("Error: REACT_APP_SEPOLIA_CONTRACT_ADDRESS is not defined in .env");
    process.exit(1);
  }

  console.log("Querying FingerprintRegistered events from:", CONTRACT_ADDRESS);

  const AIFingerprint = await ethers.getContractFactory("AIFingerprint");
  const contract = AIFingerprint.attach(CONTRACT_ADDRESS);

  const filter = contract.filters.FingerprintRegistered();
  console.log("Filter topics:", filter.topics);

  const chainId = parseInt(process.env.REACT_APP_SEPOLIA_CHAIN_ID || "11155111", 10);
  const startBlock = chainId === 11155111 ? chainId - 757111 : 0;

  try {
    const events = await contract.queryFilter(filter, startBlock, "latest");
    console.log(`Found ${events.length} events:`);
    for (const event of events) {
      console.log(`- Agent ID: ${event.args[1]}, Name: ${event.args[2]}, Hash: ${event.args[0]}`);
    }
  } catch (err) {
    console.error("Query failed:", err);
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});

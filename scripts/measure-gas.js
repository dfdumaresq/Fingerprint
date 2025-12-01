const { ethers } = require("hardhat");

async function main() {
  console.log("Deploying AIFingerprint contract...");
  
  const AIFingerprint = await ethers.getContractFactory("AIFingerprint");
  const contract = await AIFingerprint.deploy();
  await contract.waitForDeployment();
  
  console.log("Contract deployed to:", await contract.getAddress());
  console.log("\n=== Gas Usage Measurements ===\n");

  // Test data
  const sampleAgent = {
    id: "agent-001",
    name: "TestBot",
    provider: "Test Provider",
    version: "1.0.0",
    fingerprintHash: "0x1234567890123456789012345678901234567890123456789012345678901234"
  };

  // Measure registration gas
  console.log("1. Registering fingerprint...");
  const registerTx = await contract.registerFingerprint(
    sampleAgent.id,
    sampleAgent.name,
    sampleAgent.provider,
    sampleAgent.version,
    sampleAgent.fingerprintHash
  );
  const registerReceipt = await registerTx.wait();
  const registerGas = registerReceipt.gasUsed;
  
  console.log(`   Gas used for registration: ${registerGas.toString()}`);
  console.log(`   Gas used (formatted): ${(Number(registerGas) / 1000).toFixed(1)}k`);

  // Measure verification gas (view function - no gas cost on-chain, but we can estimate)
  console.log("\n2. Verifying fingerprint...");
  const verifyTx = await contract.verifyFingerprint.staticCall(sampleAgent.fingerprintHash);
  console.log(`   Verification result: ${verifyTx[0]}`);
  console.log(`   Note: verifyFingerprint is a view function (no gas cost for reads)`);

  // Measure extended verification
  console.log("\n3. Extended verification...");
  const verifyExtTx = await contract.verifyFingerprintExtended.staticCall(sampleAgent.fingerprintHash);
  console.log(`   Extended verification result: ${verifyExtTx[0]}`);
  console.log(`   Note: verifyFingerprintExtended is also a view function (no gas cost for reads)`);

  // Measure behavioral trait registration
  console.log("\n4. Registering behavioral trait...");
  const traitTx = await contract.registerBehavioralTrait(
    sampleAgent.fingerprintHash,
    "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    "v1.0"
  );
  const traitReceipt = await traitTx.wait();
  const traitGas = traitReceipt.gasUsed;
  
  console.log(`   Gas used for behavioral trait registration: ${traitGas.toString()}`);
  console.log(`   Gas used (formatted): ${(Number(traitGas) / 1000).toFixed(1)}k`);

  // Summary
  console.log("\n=== Summary ===");
  console.log(`Registration: ~${(Number(registerGas) / 1000).toFixed(0)}k gas`);
  console.log(`Behavioral Trait: ~${(Number(traitGas) / 1000).toFixed(0)}k gas`);
  console.log(`Verification: 0 gas (view function - free to call)`);
  console.log("\nNote: Verification functions are 'view' functions that don't modify state,");
  console.log("so they cost 0 gas when called directly (not in a transaction).");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

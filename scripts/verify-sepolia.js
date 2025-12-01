const hre = require("hardhat");
const { ethers } = require("hardhat");

async function main() {
  console.log("Starting verification on Sepolia...");

  // Contract address from deployment
  const CONTRACT_ADDRESS = "0x262bbFF34A58fBff943a0aA939fFA9B26B81A8ab";
  
  // Get signer
  const [signer] = await ethers.getSigners();
  console.log("Using account:", signer.address);
  
  // Get contract instance
  const AIFingerprint = await ethers.getContractFactory("AIFingerprint");
  const contract = AIFingerprint.attach(CONTRACT_ADDRESS);

  // Generate unique ID for this test run
  const timestamp = Date.now();
  const agentId = `cli-test-agent-${timestamp}`;
  const fingerprintHash = ethers.keccak256(ethers.toUtf8Bytes(agentId));
  
  console.log(`\n1. Registering Fingerprint...`);
  console.log(`   ID: ${agentId}`);
  console.log(`   Hash: ${fingerprintHash}`);

  try {
    const tx1 = await contract.registerFingerprint(
      agentId,
      "CLI Test Agent",
      "Dumaresq Software",
      "1.0.0",
      fingerprintHash
    );
    console.log(`   Transaction sent: ${tx1.hash}`);
    console.log("   Waiting for confirmation...");
    await tx1.wait();
    console.log("   ✅ Fingerprint registered successfully!");
  } catch (error) {
    console.error("   ❌ Registration failed:", error.message);
    return;
  }

  console.log(`\n2. Registering Behavioral Trait...`);
  const traitHash = ethers.keccak256(ethers.toUtf8Bytes(`behavior-${timestamp}`));
  const traitVersion = "reasoning-v1.0";
  
  console.log(`   Trait Hash: ${traitHash}`);
  console.log(`   Version: ${traitVersion}`);

  try {
    const tx2 = await contract.registerBehavioralTrait(
      fingerprintHash,
      traitHash,
      traitVersion
    );
    console.log(`   Transaction sent: ${tx2.hash}`);
    console.log("   Waiting for confirmation...");
    await tx2.wait();
    console.log("   ✅ Behavioral trait registered successfully!");
  } catch (error) {
    console.error("   ❌ Behavioral registration failed:", error.message);
  }

  console.log(`\n3. Verifying On-Chain Data...`);
  
  // Verify Fingerprint
  const fpData = await contract.verifyFingerprintExtended(fingerprintHash);
  console.log("   Fingerprint Verification:");
  console.log(`   - Exists: ${fpData.isVerified}`);
  console.log(`   - Name: ${fpData.name}`);
  console.log(`   - Revoked: ${fpData.revoked}`);

  // Verify Behavioral Trait
  const traitData = await contract.getBehavioralTraitData(fingerprintHash);
  console.log("   Behavioral Trait Verification:");
  console.log(`   - Exists: ${traitData.exists}`);
  console.log(`   - Hash Matches: ${traitData.traitHash === traitHash}`);
  console.log(`   - Version: ${traitData.traitVersion}`);

  // Verify Match
  const isMatch = await contract.verifyBehavioralMatch(fingerprintHash, traitHash);
  console.log(`   - verifyBehavioralMatch() result: ${isMatch}`);

  if (fpData.isVerified && traitData.exists && isMatch) {
    console.log("\n✅ SUCCESS: Full system verification complete on Sepolia!");
  } else {
    console.log("\n⚠️ WARNING: Verification checks failed.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AIFingerprint", function () {
  let AIFingerprint;
  let contract;
  let owner;
  let addr1;
  let addr2;

  // Sample agent data for testing
  const sampleAgent = {
    id: "agent-001",
    name: "TestBot",
    provider: "Test Provider",
    version: "1.0.0",
    fingerprintHash: "0x1234567890123456789012345678901234567890123456789012345678901234"
  };

  beforeEach(async function () {
    // Get signers
    [owner, addr1, addr2] = await ethers.getSigners();
    
    // Deploy contract
    AIFingerprint = await ethers.getContractFactory("AIFingerprint");
    contract = await AIFingerprint.deploy();
  });

  describe("Deployment", function () {
    it("Should deploy successfully", async function () {
      expect(await contract.getAddress()).to.be.properAddress;
    });
  });

  describe("Fingerprint Registration", function () {
    it("Should register a new fingerprint", async function () {
      // Register a fingerprint
      await contract.registerFingerprint(
        sampleAgent.id,
        sampleAgent.name,
        sampleAgent.provider,
        sampleAgent.version,
        sampleAgent.fingerprintHash
      );

      // Verify the fingerprint
      const [isVerified, id, name, provider, version] = await contract.verifyFingerprint(sampleAgent.fingerprintHash);

      expect(isVerified).to.equal(true);
      expect(id).to.equal(sampleAgent.id);
      expect(name).to.equal(sampleAgent.name);
      expect(provider).to.equal(sampleAgent.provider);
      expect(version).to.equal(sampleAgent.version);
    });

    it("Should fail to register a duplicate fingerprint", async function () {
      // Register a fingerprint
      await contract.registerFingerprint(
        sampleAgent.id,
        sampleAgent.name,
        sampleAgent.provider,
        sampleAgent.version,
        sampleAgent.fingerprintHash
      );

      // Attempt to register the same fingerprint again
      await expect(
        contract.registerFingerprint(
          sampleAgent.id,
          sampleAgent.name,
          sampleAgent.provider,
          sampleAgent.version,
          sampleAgent.fingerprintHash
        )
      ).to.be.revertedWith("Fingerprint already registered");
    });
  });

  describe("Fingerprint Verification", function () {
    it("Should return false for non-existent fingerprints", async function () {
      const [isVerified] = await contract.verifyFingerprint("0x0000000000000000000000000000000000000000000000000000000000000000");
      expect(isVerified).to.equal(false);
    });

    it("Should track the address that registered the fingerprint", async function () {
      // Register fingerprint from addr1
      await contract.connect(addr1).registerFingerprint(
        sampleAgent.id,
        sampleAgent.name,
        sampleAgent.provider,
        sampleAgent.version,
        sampleAgent.fingerprintHash
      );

      // Check that getRegisteredBy returns addr1's address
      const registeredBy = await contract.getRegisteredBy(sampleAgent.fingerprintHash);
      expect(registeredBy).to.equal(await addr1.getAddress());
    });
  });
});
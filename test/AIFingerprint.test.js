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

  describe("Ownership and Administration", function () {
    it("Should set the deployer as the owner", async function () {
      expect(await contract.owner()).to.equal(await owner.getAddress());
    });

    it("Should allow the owner to transfer contract ownership", async function () {
      // Transfer ownership to addr1
      await contract.transferOwnership(await addr1.getAddress());

      // Check that ownership was transferred
      expect(await contract.owner()).to.equal(await addr1.getAddress());

      // Transfer ownership back to the original owner for other tests
      await contract.connect(addr1).transferOwnership(await owner.getAddress());
    });

    it("Should allow the owner to pause and unpause the contract", async function () {
      // Initially, the contract should not be paused
      expect(await contract.paused()).to.equal(false);

      // Pause the contract
      await contract.pause();

      // Check that the contract is now paused
      expect(await contract.paused()).to.equal(true);

      // Try to register a fingerprint while the contract is paused
      const testHash = "0x5555555555555555555555555555555555555555555555555555555555555555";
      await expect(
        contract.registerFingerprint("test", "Test Agent", "Test Provider", "1.0.0", testHash)
      ).to.be.reverted;

      // Unpause the contract
      await contract.unpause();

      // Check that the contract is now unpaused
      expect(await contract.paused()).to.equal(false);

      // Now registering should work
      await contract.registerFingerprint("test", "Test Agent", "Test Provider", "1.0.0", testHash);
    });

    it("Should allow the owner to transfer ownership of a fingerprint", async function () {
      // First register a fingerprint as addr1
      const testHash = "0x6666666666666666666666666666666666666666666666666666666666666666";
      await contract.connect(addr1).registerFingerprint(
        "ownership-test",
        "Ownership Test Agent",
        "Test Provider",
        "1.0.0",
        testHash
      );

      // Verify addr1 is the registered owner
      expect(await contract.getRegisteredBy(testHash)).to.equal(await addr1.getAddress());

      // Transfer ownership to addr2
      await contract.transferFingerprintOwnership(testHash, await addr2.getAddress());

      // Verify addr2 is now the registered owner
      expect(await contract.getRegisteredBy(testHash)).to.equal(await addr2.getAddress());

      // Now addr2 should be able to revoke the fingerprint, but not addr1
      await expect(
        contract.connect(addr1).revokeFingerprint(testHash)
      ).to.be.revertedWith("Only the original registrant can revoke the fingerprint");

      // addr2 should successfully revoke
      await contract.connect(addr2).revokeFingerprint(testHash);

      // Check revocation status
      const [revoked] = await contract.isRevoked(testHash);
      expect(revoked).to.equal(true);
    });
  });

  describe("Fingerprint Revocation", function () {
    const revocationTestHash = "0x2222222222222222222222222222222222222222222222222222222222222222";
    const adminRevocationTestHash = "0x4444444444444444444444444444444444444444444444444444444444444444";

    beforeEach(async function () {
      // Register a fingerprint for revocation testing
      await contract.registerFingerprint(
        "revocation-test",
        "Revocation Test Agent",
        "Test Provider",
        "1.0.0",
        revocationTestHash
      );

      // Register a fingerprint for admin revocation testing (registered by addr1)
      await contract.connect(addr1).registerFingerprint(
        "admin-revocation-test",
        "Admin Revocation Test Agent",
        "Test Provider",
        "1.0.0",
        adminRevocationTestHash
      );
    });

    it("Should allow the owner to revoke a fingerprint", async function () {
      // Revoke the fingerprint
      await contract.revokeFingerprint(revocationTestHash);

      // Check revocation status
      const [revoked, revokedAt, revokedBy] = await contract.isRevoked(revocationTestHash);

      expect(revoked).to.equal(true);
      expect(revokedAt).to.be.gt(0); // Timestamp should be set
      expect(revokedBy).to.equal(await owner.getAddress());
    });

    it("Should not allow non-owners to revoke a fingerprint", async function () {
      // Try to revoke from a different address
      await expect(
        contract.connect(addr2).revokeFingerprint(revocationTestHash)
      ).to.be.revertedWith("Only the original registrant can revoke the fingerprint");
    });

    it("Should not allow revoking a fingerprint that doesn't exist", async function () {
      const nonExistentHash = "0x3333333333333333333333333333333333333333333333333333333333333333";

      await expect(
        contract.revokeFingerprint(nonExistentHash)
      ).to.be.revertedWith("Fingerprint does not exist");
    });

    it("Should not allow revoking a fingerprint twice", async function () {
      // Revoke once
      await contract.revokeFingerprint(revocationTestHash);

      // Try to revoke again
      await expect(
        contract.revokeFingerprint(revocationTestHash)
      ).to.be.revertedWith("Fingerprint already revoked");
    });

    it("Should report the fingerprint as invalid after revocation", async function () {
      // Verify fingerprint is valid before revocation
      const [isVerifiedBefore] = await contract.verifyFingerprintExtended(revocationTestHash);
      expect(isVerifiedBefore).to.equal(true);

      // Revoke the fingerprint
      await contract.revokeFingerprint(revocationTestHash);

      // Verify fingerprint is invalid after revocation
      const [isVerifiedAfter] = await contract.verifyFingerprintExtended(revocationTestHash);
      expect(isVerifiedAfter).to.equal(false);
    });

    it("Should allow the contract owner to revoke any fingerprint using adminRevokeFingerprint", async function () {
      // Use adminRevokeFingerprint to revoke a fingerprint that was registered by addr1
      await contract.adminRevokeFingerprint(adminRevocationTestHash);

      // Check revocation status
      const [revoked, revokedAt, revokedBy] = await contract.isRevoked(adminRevocationTestHash);

      expect(revoked).to.equal(true);
      expect(revokedAt).to.be.gt(0);
      expect(revokedBy).to.equal(await owner.getAddress()); // The contract owner should be the revoker
    });

    it("Should not allow non-owners to use the adminRevokeFingerprint function", async function () {
      // Try to use adminRevokeFingerprint from a non-owner address
      await expect(
        contract.connect(addr1).adminRevokeFingerprint(revocationTestHash)
      ).to.be.reverted;
    });
  });
});
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Behavioral Verification", function () {
  let AIFingerprint;
  let contract;
  let owner;
  let addr1;
  let addr2;

  // Sample data for testing
  const sampleAgent = {
    id: "agent-behavioral-001",
    name: "BehavioralTestBot",
    provider: "Test Provider",
    version: "1.0.0",
    fingerprintHash: "0xabcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd1234"
  };

  const sampleTrait = {
    traitHash: "0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff",
    traitVersion: "reasoning-v1.0"
  };

  const updatedTrait = {
    traitHash: "0x9999888877776666555544443333222211110000ffffeeeeddddbbbbaaaaabcd",
    traitVersion: "reasoning-v1.1"
  };

  beforeEach(async function () {
    // Get signers
    [owner, addr1, addr2] = await ethers.getSigners();
    
    // Deploy contract
    AIFingerprint = await ethers.getContractFactory("AIFingerprint");
    contract = await AIFingerprint.deploy();

    // Register a fingerprint for behavioral testing
    await contract.connect(addr1).registerFingerprint(
      sampleAgent.id,
      sampleAgent.name,
      sampleAgent.provider,
      sampleAgent.version,
      sampleAgent.fingerprintHash
    );
  });

  describe("Behavioral Trait Registration", function () {
    it("Should register a behavioral trait for an existing fingerprint", async function () {
      // Register behavioral trait
      await contract.connect(addr1).registerBehavioralTrait(
        sampleAgent.fingerprintHash,
        sampleTrait.traitHash,
        sampleTrait.traitVersion
      );

      // Verify the trait was registered
      const [exists, traitHash, traitVersion, registeredAt, lastUpdatedAt] = 
        await contract.getBehavioralTraitData(sampleAgent.fingerprintHash);

      expect(exists).to.equal(true);
      expect(traitHash).to.equal(sampleTrait.traitHash);
      expect(traitVersion).to.equal(sampleTrait.traitVersion);
      expect(registeredAt).to.be.gt(0);
      expect(lastUpdatedAt).to.equal(registeredAt); // Should be same on initial registration
    });

    it("Should fail to register behavioral trait for non-existent fingerprint", async function () {
      const nonExistentHash = "0x0000000000000000000000000000000000000000000000000000000000000000";

      await expect(
        contract.connect(addr1).registerBehavioralTrait(
          nonExistentHash,
          sampleTrait.traitHash,
          sampleTrait.traitVersion
        )
      ).to.be.revertedWith("Fingerprint must be registered first");
    });

    it("Should fail if non-owner tries to register behavioral trait", async function () {
      // addr2 tries to register trait for addr1's fingerprint
      await expect(
        contract.connect(addr2).registerBehavioralTrait(
          sampleAgent.fingerprintHash,
          sampleTrait.traitHash,
          sampleTrait.traitVersion
        )
      ).to.be.revertedWith("Only fingerprint owner can register behavioral trait");
    });

    it("Should fail to register behavioral trait twice", async function () {
      // Register once
      await contract.connect(addr1).registerBehavioralTrait(
        sampleAgent.fingerprintHash,
        sampleTrait.traitHash,
        sampleTrait.traitVersion
      );

      // Try to register again
      await expect(
        contract.connect(addr1).registerBehavioralTrait(
          sampleAgent.fingerprintHash,
          sampleTrait.traitHash,
          sampleTrait.traitVersion
        )
      ).to.be.revertedWith("Behavioral trait already registered - use update instead");
    });

    it("Should emit BehavioralTraitRegistered event", async function () {
      await expect(
        contract.connect(addr1).registerBehavioralTrait(
          sampleAgent.fingerprintHash,
          sampleTrait.traitHash,
          sampleTrait.traitVersion
        )
      ).to.emit(contract, "BehavioralTraitRegistered")
        .withArgs(
          sampleAgent.fingerprintHash,
          sampleTrait.traitHash,
          sampleTrait.traitVersion,
          await addr1.getAddress(),
          (await ethers.provider.getBlock('latest')).timestamp + 1
        );
    });
  });

  describe("Behavioral Trait Updates", function () {
    beforeEach(async function () {
      // Register initial behavioral trait
      await contract.connect(addr1).registerBehavioralTrait(
        sampleAgent.fingerprintHash,
        sampleTrait.traitHash,
        sampleTrait.traitVersion
      );
    });

    it("Should update an existing behavioral trait", async function () {
      // Update the behavioral trait
      await contract.connect(addr1).updateBehavioralTrait(
        sampleAgent.fingerprintHash,
        updatedTrait.traitHash,
        updatedTrait.traitVersion
      );

      // Verify the trait was updated
      const [exists, traitHash, traitVersion, registeredAt, lastUpdatedAt] = 
        await contract.getBehavioralTraitData(sampleAgent.fingerprintHash);

      expect(exists).to.equal(true);
      expect(traitHash).to.equal(updatedTrait.traitHash);
      expect(traitVersion).to.equal(updatedTrait.traitVersion);
      expect(lastUpdatedAt).to.be.gt(registeredAt); // Should be updated
    });

    it("Should fail to update non-existent behavioral trait", async function () {
      const nonExistentHash = "0x0000000000000000000000000000000000000000000000000000000000000000";

      await expect(
        contract.connect(addr1).updateBehavioralTrait(
          nonExistentHash,
          updatedTrait.traitHash,
          updatedTrait.traitVersion
        )
      ).to.be.revertedWith("Behavioral trait not registered yet");
    });

    it("Should fail if non-owner tries to update behavioral trait", async function () {
      // addr2 tries to update addr1's behavioral trait
      await expect(
        contract.connect(addr2).updateBehavioralTrait(
          sampleAgent.fingerprintHash,
          updatedTrait.traitHash,
          updatedTrait.traitVersion
        )
      ).to.be.revertedWith("Only fingerprint owner can update behavioral trait");
    });

    it("Should emit BehavioralTraitUpdated event", async function () {
      await expect(
        contract.connect(addr1).updateBehavioralTrait(
          sampleAgent.fingerprintHash,
          updatedTrait.traitHash,
          updatedTrait.traitVersion
        )
      ).to.emit(contract, "BehavioralTraitUpdated")
        .withArgs(
          sampleAgent.fingerprintHash,
          sampleTrait.traitHash,
          updatedTrait.traitHash,
          updatedTrait.traitVersion,
          await addr1.getAddress(),
          (await ethers.provider.getBlock('latest')).timestamp + 1
        );
    });
  });

  describe("Behavioral Trait Data Retrieval", function () {
    it("Should return correct data for registered behavioral trait", async function () {
      // Register behavioral trait
      await contract.connect(addr1).registerBehavioralTrait(
        sampleAgent.fingerprintHash,
        sampleTrait.traitHash,
        sampleTrait.traitVersion
      );

      // Get the data
      const [exists, traitHash, traitVersion, registeredAt, lastUpdatedAt] = 
        await contract.getBehavioralTraitData(sampleAgent.fingerprintHash);

      expect(exists).to.equal(true);
      expect(traitHash).to.equal(sampleTrait.traitHash);
      expect(traitVersion).to.equal(sampleTrait.traitVersion);
      expect(registeredAt).to.be.gt(0);
      expect(lastUpdatedAt).to.be.gt(0);
    });

    it("Should return false for non-existent behavioral trait", async function () {
      const nonExistentHash = "0x0000000000000000000000000000000000000000000000000000000000000000";

      const [exists] = await contract.getBehavioralTraitData(nonExistentHash);

      expect(exists).to.equal(false);
    });
  });

  describe("Behavioral Match Verification", function () {
    beforeEach(async function () {
      // Register behavioral trait
      await contract.connect(addr1).registerBehavioralTrait(
        sampleAgent.fingerprintHash,
        sampleTrait.traitHash,
        sampleTrait.traitVersion
      );
    });

    it("Should return true when behavioral trait matches", async function () {
      const matches = await contract.verifyBehavioralMatch(
        sampleAgent.fingerprintHash,
        sampleTrait.traitHash
      );

      expect(matches).to.equal(true);
    });

    it("Should return false when behavioral trait does not match", async function () {
      const differentHash = "0x9999999999999999999999999999999999999999999999999999999999999999";

      const matches = await contract.verifyBehavioralMatch(
        sampleAgent.fingerprintHash,
        differentHash
      );

      expect(matches).to.equal(false);
    });

    it("Should fail to verify behavioral match for non-existent trait", async function () {
      const nonExistentHash = "0x0000000000000000000000000000000000000000000000000000000000000000";

      await expect(
        contract.verifyBehavioralMatch(
          nonExistentHash,
          sampleTrait.traitHash
        )
      ).to.be.revertedWith("No behavioral trait registered for this fingerprint");
    });

    it("Should detect behavioral drift after update", async function () {
      // Verify initial match
      let matches = await contract.verifyBehavioralMatch(
        sampleAgent.fingerprintHash,
        sampleTrait.traitHash
      );
      expect(matches).to.equal(true);

      // Update the trait (simulating drift)
      await contract.connect(addr1).updateBehavioralTrait(
        sampleAgent.fingerprintHash,
        updatedTrait.traitHash,
        updatedTrait.traitVersion
      );

      // Old hash should no longer match
      matches = await contract.verifyBehavioralMatch(
        sampleAgent.fingerprintHash,
        sampleTrait.traitHash
      );
      expect(matches).to.equal(false);

      // New hash should match
      matches = await contract.verifyBehavioralMatch(
        sampleAgent.fingerprintHash,
        updatedTrait.traitHash
      );
      expect(matches).to.equal(true);
    });
  });

  describe("Behavioral Traits with Contract Pause", function () {
    it("Should not allow behavioral trait registration when paused", async function () {
      // Pause the contract
      await contract.pause();

      // Try to register behavioral trait
      await expect(
        contract.connect(addr1).registerBehavioralTrait(
          sampleAgent.fingerprintHash,
          sampleTrait.traitHash,
          sampleTrait.traitVersion
        )
      ).to.be.reverted;
    });

    it("Should not allow behavioral trait update when paused", async function () {
      // Register trait first
      await contract.connect(addr1).registerBehavioralTrait(
        sampleAgent.fingerprintHash,
        sampleTrait.traitHash,
        sampleTrait.traitVersion
      );

      // Pause the contract
      await contract.pause();

      // Try to update behavioral trait
      await expect(
        contract.connect(addr1).updateBehavioralTrait(
          sampleAgent.fingerprintHash,
          updatedTrait.traitHash,
          updatedTrait.traitVersion
        )
      ).to.be.reverted;
    });

    it("Should allow behavioral trait verification when paused", async function () {
      // Register trait first
      await contract.connect(addr1).registerBehavioralTrait(
        sampleAgent.fingerprintHash,
        sampleTrait.traitHash,
        sampleTrait.traitVersion
      );

      // Pause the contract
      await contract.pause();

      // Verification (view function) should still work
      const matches = await contract.verifyBehavioralMatch(
        sampleAgent.fingerprintHash,
        sampleTrait.traitHash
      );

      expect(matches).to.equal(true);
    });
  });
});

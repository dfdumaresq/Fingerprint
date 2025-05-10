const { expect } = require("chai");
const { ethers } = require("hardhat");

// We need to manually import our TypeScript utility functions
// Since we're in a JavaScript test environment, we need to use CommonJS syntax
// This will need to be transpiled to work correctly in the test environment
describe("EIP-712 Typed Data Signature", function () {
  let contract;
  let contractAddress;
  let owner;
  let eip712Utils;

  // Sample agent data for testing
  const sampleAgent = {
    id: "agent-123",
    name: "Test Agent",
    provider: "Test Provider",
    version: "1.0.0"
  };

  // Define our EIP-712 domain and types - duplicated here for testing without imports
  const EIP712_DOMAIN = {
    name: 'AIFingerprint',
    version: '1'
  };

  const AGENT_FINGERPRINT_TYPES = {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    AgentFingerprint: [
      { name: 'id', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'provider', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'timestamp', type: 'uint256' },
    ],
  };

  beforeEach(async function () {
    // Get signers
    [owner] = await ethers.getSigners();

    // Deploy contract
    const AIFingerprint = await ethers.getContractFactory("AIFingerprint");
    contract = await AIFingerprint.deploy();
    contractAddress = await contract.getAddress();
  });

  describe("EIP-712 Domain Generation", function() {
    it("Should generate EIP-712 domain with correct values", async function () {
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const domain = {
        ...EIP712_DOMAIN,
        chainId: chainId,
        verifyingContract: contractAddress
      };

      expect(domain.name).to.equal("AIFingerprint");
      expect(domain.version).to.equal("1");
      expect(domain.chainId).to.equal(chainId);
      expect(domain.verifyingContract).to.equal(contractAddress);
    });
  });

  describe("EIP-712 Message Creation", function() {
    it("Should create agent fingerprint message correctly", async function () {
      const timestamp = Math.floor(Date.now() / 1000);

      const message = {
        id: sampleAgent.id,
        name: sampleAgent.name,
        provider: sampleAgent.provider,
        version: sampleAgent.version,
        timestamp: timestamp
      };

      expect(message.id).to.equal(sampleAgent.id);
      expect(message.name).to.equal(sampleAgent.name);
      expect(message.provider).to.equal(sampleAgent.provider);
      expect(message.version).to.equal(sampleAgent.version);
      expect(message.timestamp).to.be.a("number");
    });
  });

  describe("EIP-712 Signature and Verification", function() {
    it("Should sign and verify agent fingerprint message", async function () {
      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Create the domain and message
      const domain = {
        ...EIP712_DOMAIN,
        chainId: chainId,
        verifyingContract: contractAddress
      };

      const timestamp = Math.floor(Date.now() / 1000);
      const message = {
        id: sampleAgent.id,
        name: sampleAgent.name,
        provider: sampleAgent.provider,
        version: sampleAgent.version,
        timestamp: timestamp
      };

      // Sign the message with owner's wallet
      const typedData = {
        domain,
        types: {
          EIP712Domain: AGENT_FINGERPRINT_TYPES.EIP712Domain,
          AgentFingerprint: AGENT_FINGERPRINT_TYPES.AgentFingerprint
        },
        primaryType: 'AgentFingerprint',
        message
      };

      // Sign the message
      const signature = await owner.signTypedData(
        domain,
        { AgentFingerprint: AGENT_FINGERPRINT_TYPES.AgentFingerprint },
        message
      );

      expect(signature).to.be.a("string");
      expect(signature).to.match(/^0x[0-9a-f]+$/i);

      // Verify the signature
      const recoveredAddress = ethers.verifyTypedData(
        domain,
        { AgentFingerprint: AGENT_FINGERPRINT_TYPES.AgentFingerprint },
        message,
        signature
      );

      expect(recoveredAddress).to.equal(await owner.getAddress());
    });

    it("Should reject signature verification with incorrect data", async function () {
      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Create the domain and message
      const domain = {
        ...EIP712_DOMAIN,
        chainId: chainId,
        verifyingContract: contractAddress
      };

      const timestamp = Math.floor(Date.now() / 1000);
      const message = {
        id: sampleAgent.id,
        name: sampleAgent.name,
        provider: sampleAgent.provider,
        version: sampleAgent.version,
        timestamp: timestamp
      };

      // Sign the message
      const signature = await owner.signTypedData(
        domain,
        { AgentFingerprint: AGENT_FINGERPRINT_TYPES.AgentFingerprint },
        message
      );

      // Tamper with the message
      const tamperedMessage = {
        ...message,
        name: "Different Name"
      };

      // Verify with the tampered message
      const recoveredAddress = ethers.verifyTypedData(
        domain,
        { AgentFingerprint: AGENT_FINGERPRINT_TYPES.AgentFingerprint },
        tamperedMessage,
        signature
      );

      // Should NOT match the owner's address
      expect(recoveredAddress).to.not.equal(await owner.getAddress());
    });
  });
});
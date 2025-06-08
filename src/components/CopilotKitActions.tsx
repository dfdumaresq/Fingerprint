import { useCopilotAction, useCopilotReadable } from '@copilotkit/react-core';
import { useBlockchain } from '../contexts/BlockchainContext';

/**
 * CopilotKit Actions for AI Agent Fingerprinting System
 * 
 * This component sets up actions that allow AI agents to:
 * - Register their own fingerprints autonomously
 * - Verify other agents' identities
 * - Check connection status and network info
 * - Generate fingerprints for validation
 * - Revoke fingerprints when needed
 */
export const CopilotKitActions: React.FC = () => {
  const {
    registerAgent,
    verifyAgent,
    revokeAgent,
    generateFingerprint,
    getConnectionStatus,
    getNetworkInfo,
    isWalletReady,
    connectWallet
  } = useBlockchain();

  // Make current blockchain state readable to the AI
  useCopilotReadable({
    description: "Current blockchain connection status and network information",
    value: {
      connectionStatus: getConnectionStatus(),
      networkInfo: getNetworkInfo(),
      walletReady: isWalletReady()
    }
  });

  // Action: Register AI Agent Fingerprint
  useCopilotAction({
    name: "registerAgentFingerprint",
    description: "Register an AI agent's fingerprint on the blockchain for verification and trust establishment",
    parameters: [
      {
        name: "id",
        type: "string",
        description: "Unique identifier for the AI agent",
        required: true
      },
      {
        name: "name",
        type: "string", 
        description: "Human-readable name of the AI agent",
        required: true
      },
      {
        name: "provider",
        type: "string",
        description: "The organization or service that provides this AI agent (e.g., 'OpenAI', 'Anthropic', 'CustomAI')",
        required: true
      },
      {
        name: "version",
        type: "string",
        description: "Version identifier of the AI agent (e.g., 'v1.0', 'gpt-4', 'claude-3')",
        required: true
      },
      {
        name: "useEIP712",
        type: "boolean",
        description: "Whether to use EIP-712 typed data signatures for enhanced security",
        required: false
      }
    ],
    handler: async ({ id, name, provider, version, useEIP712 = false }) => {
      if (!isWalletReady()) {
        return "❌ Wallet not connected. Please connect your wallet first to register agent fingerprints.";
      }

      const result = await registerAgent({ id, name, provider, version }, useEIP712);
      
      if (result.success) {
        return `✅ Agent fingerprint registered successfully!
        
**Agent Details:**
- ID: ${id}
- Name: ${name}
- Provider: ${provider}
- Version: ${version}
- Fingerprint Hash: ${result.data?.fingerprintHash}
- Transaction Hash: ${result.data?.transactionHash}

The agent is now verified on the blockchain and can be trusted by other agents.`;
      } else {
        return `❌ Registration failed: ${result.error}
        
Details: ${result.details}`;
      }
    }
  });

  // Action: Verify AI Agent Fingerprint
  useCopilotAction({
    name: "verifyAgentFingerprint",
    description: "Verify an AI agent's identity by checking their fingerprint on the blockchain",
    parameters: [
      {
        name: "fingerprintHash",
        type: "string",
        description: "The fingerprint hash to verify (must start with 0x and be 66 characters long)",
        required: true
      }
    ],
    handler: async ({ fingerprintHash }) => {
      // Validate fingerprint format
      if (!fingerprintHash.startsWith('0x') || fingerprintHash.length !== 66) {
        return "❌ Invalid fingerprint format. Must be 0x followed by 64 hexadecimal characters.";
      }

      const result = await verifyAgent(fingerprintHash);
      
      if (result.success && result.data) {
        const agent = result.data;
        const statusEmoji = agent.revoked ? "🚫" : "✅";
        const statusText = agent.revoked ? "REVOKED" : "VERIFIED";
        
        return `${statusEmoji} Agent verification result: **${statusText}**
        
**Agent Information:**
- ID: ${agent.id}
- Name: ${agent.name}
- Provider: ${agent.provider}
- Version: ${agent.version}
- Registered: ${new Date(agent.createdAt * 1000).toLocaleString()}
- Status: ${agent.revoked ? `Revoked on ${new Date((agent.revokedAt || 0) * 1000).toLocaleString()}` : 'Active and Valid'}

${agent.revoked ? '⚠️ **Warning**: This agent has been revoked and should not be trusted.' : '🎉 This agent is verified and can be trusted!'}`;
      } else {
        return `❌ Verification failed: ${result.error}
        
Details: ${result.details}`;
      }
    }
  });

  // Action: Generate Fingerprint Hash
  useCopilotAction({
    name: "generateAgentFingerprint",
    description: "Generate a unique fingerprint hash for an AI agent without registering it on the blockchain",
    parameters: [
      {
        name: "id",
        type: "string",
        description: "Unique identifier for the AI agent",
        required: true
      },
      {
        name: "name",
        type: "string",
        description: "Human-readable name of the AI agent", 
        required: true
      },
      {
        name: "provider",
        type: "string",
        description: "The organization or service that provides this AI agent",
        required: true
      },
      {
        name: "version",
        type: "string",
        description: "Version identifier of the AI agent",
        required: true
      }
    ],
    handler: async ({ id, name, provider, version }) => {
      const result = await generateFingerprint({ id, name, provider, version });
      
      if (result.success) {
        return `🔑 Fingerprint generated successfully!
        
**Agent Details:**
- ID: ${id}
- Name: ${name}
- Provider: ${provider}
- Version: ${version}
- **Fingerprint Hash:** ${result.data?.fingerprintHash}

💡 This fingerprint can be used to register the agent on the blockchain or for verification purposes.`;
      } else {
        return `❌ Fingerprint generation failed: ${result.error}
        
Details: ${result.details}`;
      }
    }
  });

  // Action: Revoke Agent Fingerprint
  useCopilotAction({
    name: "revokeAgentFingerprint", 
    description: "Revoke an AI agent's fingerprint on the blockchain (can only be done by the original registrant)",
    parameters: [
      {
        name: "fingerprintHash",
        type: "string",
        description: "The fingerprint hash to revoke (must start with 0x and be 66 characters long)",
        required: true
      }
    ],
    handler: async ({ fingerprintHash }) => {
      if (!isWalletReady()) {
        return "❌ Wallet not connected. Please connect your wallet first to revoke agent fingerprints.";
      }

      // Validate fingerprint format
      if (!fingerprintHash.startsWith('0x') || fingerprintHash.length !== 66) {
        return "❌ Invalid fingerprint format. Must be 0x followed by 64 hexadecimal characters.";
      }

      const result = await revokeAgent(fingerprintHash);
      
      if (result.success) {
        return `🚫 Agent fingerprint revoked successfully!
        
**Revocation Details:**
- Fingerprint Hash: ${fingerprintHash}
- Transaction Hash: ${result.data?.transactionHash}
- Status: Permanently revoked

⚠️ **Important**: This action is permanent and cannot be undone. The agent will now fail all verification checks.`;
      } else {
        return `❌ Revocation failed: ${result.error}
        
Details: ${result.details}

💡 **Note**: You can only revoke fingerprints that you originally registered.`;
      }
    }
  });

  // Action: Connect Wallet
  useCopilotAction({
    name: "connectWallet",
    description: "Connect MetaMask wallet to enable blockchain operations for AI agents",
    parameters: [],
    handler: async () => {
      try {
        const connected = await connectWallet();
        
        if (connected) {
          const status = getConnectionStatus();
          return `✅ Wallet connected successfully!
          
**Connection Details:**
- Address: ${status.address}
- Network: ${status.network}
- Status: Ready for blockchain operations

🎉 You can now register, verify, and revoke AI agent fingerprints!`;
        } else {
          return `❌ Wallet connection failed. Please ensure:
- MetaMask is installed and unlocked
- You're on the correct network (Sepolia testnet)
- You approve the connection request`;
        }
      } catch (error) {
        return `❌ Wallet connection error: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  });

  // Action: Get Network Status
  useCopilotAction({
    name: "getBlockchainStatus",
    description: "Get current blockchain connection status and network information",
    parameters: [],
    handler: async () => {
      const status = getConnectionStatus();
      const network = getNetworkInfo();
      
      return `📊 **Blockchain Status Report**
      
**Connection:**
- Status: ${status.connected ? '✅ Connected' : '❌ Disconnected'}
- Wallet Address: ${status.address || 'Not connected'}
- Loading: ${status.loading ? 'Yes' : 'No'}
- Error: ${status.error || 'None'}

**Network Information:**
- Network: ${network.name}
- Chain ID: ${network.chainId}
- Contract Address: ${network.contractAddress}

**Capabilities:**
- Register Agents: ${status.connected ? '✅ Available' : '❌ Requires wallet connection'}
- Verify Agents: ✅ Available (read-only)
- Revoke Agents: ${status.connected ? '✅ Available' : '❌ Requires wallet connection'}`;
    }
  });

  return null; // This component only sets up actions, no UI
};

export default CopilotKitActions;
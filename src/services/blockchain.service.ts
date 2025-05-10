import { ethers } from 'ethers';
import { BlockchainConfig, Agent, SignatureData } from '../types';
import {
  createEIP712Domain,
  createAgentFingerprintMessage,
  signAgentFingerprint,
  verifyAgentFingerprintSignature,
  EIP712Domain,
  AgentFingerprintMessage
} from '../utils/eip712.utils';

// Simple ABI for interacting with a smart contract that stores fingerprints
const ABI = [
  "function registerFingerprint(string id, string name, string provider, string version, string fingerprintHash) external",
  "function verifyFingerprint(string fingerprintHash) external view returns (bool isVerified, string id, string name, string provider, string version, uint256 createdAt)"
];

// Add Ethereum window type
declare global {
  interface Window {
    ethereum?: any;
  }
}

export class BlockchainService {
  private provider!: ethers.JsonRpcProvider;
  private contract!: ethers.Contract;
  private isConnected: boolean = false;
  private config: BlockchainConfig;

  constructor(config: BlockchainConfig) {
    this.config = config;
    try {
      this.provider = new ethers.JsonRpcProvider(config.networkUrl);
      this.contract = new ethers.Contract(config.contractAddress, ABI, this.provider);
      this.isConnected = true;
      console.log('Connected to blockchain network');
    } catch (error) {
      console.error('Failed to connect to blockchain:', error);
      this.isConnected = false;
    }
  }

  /**
   * Generate a fingerprint hash based on agent details
   * @param agent Agent information (without the fingerprint hash)
   * @returns A unique fingerprint hash
   */
  public generateFingerprintHash(agent: Omit<Agent, 'createdAt' | 'fingerprintHash'>): string {
    // Combine agent data into a single string
    const dataString = `${agent.id}-${agent.name}-${agent.provider}-${agent.version}-${Date.now()}`;
    
    // Convert string to bytes and hash it using ethers.js keccak256
    const dataBytes = ethers.toUtf8Bytes(dataString);
    const hash = ethers.keccak256(dataBytes);
    
    return hash;
  }

  public async connectWallet(): Promise<string | null> {
    try {
      console.log('Connecting wallet...');
      // This is a simplified example. In a real application, you would use Web3Modal or similar
      if (!window.ethereum) {
        console.error('No ethereum provider found. Please install MetaMask.');
        throw new Error("No ethereum provider found. Please install MetaMask.");
      }

      console.log('Ethereum provider found, checking if already connected...');
      
      // Try to get accounts without showing the MetaMask popup first
      // If this succeeds, it means the user has already authorized the dApp
      try {
        const accounts = await window.ethereum.request({ 
          method: 'eth_accounts' 
        });
        
        if (accounts && accounts.length > 0) {
          console.log('Already connected to account:', accounts[0]);
          
          // Check if we're on the right network
          const chainId = await window.ethereum.request({ method: 'eth_chainId' });
          console.log('Current chain ID:', chainId);
          
          // Convert to decimal and check
          if (parseInt(chainId, 16) !== 11155111) {
            console.error('Please connect to Sepolia testnet (Chain ID: 11155111)');
            throw new Error('Please connect to Sepolia testnet (Chain ID: 11155111)');
          }
          
          console.log('Creating new provider and signer...');
          const provider = new ethers.BrowserProvider(window.ethereum);
          const signer = await provider.getSigner();
          
          // Create a new contract instance with the signer that can make write transactions
          this.contract = new ethers.Contract(this.contract.target, ABI, signer);
          
          const address = await signer.getAddress();
          console.log('Connected wallet address:', address);
          this.isConnected = true;
          return address;
        }
      } catch (error) {
        console.log('Error checking existing accounts:', error);
        // Continue to request accounts
      }
      
      console.log('Requesting account access...');
      // Only request accounts if we don't already have access
      try {
        await window.ethereum.request({ 
          method: 'eth_requestAccounts',
          params: [] 
        });
        console.log('Account access granted');
      } catch (err: any) {
        // Handle the case where the user denies the request or it's already in progress
        if (err && err.code === -32002) {
          console.log('MetaMask is already processing a request. Please check the MetaMask extension and approve the connection.');
          throw new Error('MetaMask connection already in progress. Please check the MetaMask extension.');
        }
        throw err;
      }
      
      // Check if we're on the right network
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      console.log('Current chain ID:', chainId);
      
      // Convert to decimal and check
      if (parseInt(chainId, 16) !== 11155111) {
        console.error('Please connect to Sepolia testnet (Chain ID: 11155111)');
        throw new Error('Please connect to Sepolia testnet (Chain ID: 11155111)');
      }
      
      console.log('Creating new provider and signer...');
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      
      // Create a new contract instance with the signer that can make write transactions
      this.contract = new ethers.Contract(this.contract.target, ABI, signer);
      
      const address = await signer.getAddress();
      console.log('Connected wallet address:', address);
      this.isConnected = true;
      return address;
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      this.isConnected = false;
      return null;
    }
  }

  /**
   * Register a fingerprint on the blockchain
   * @param agent Agent information including fingerprint hash
   * @param useEIP712 Whether to use EIP-712 typed data for signature
   * @returns Boolean indicating success or failure
   */
  public async registerFingerprint(
    agent: Omit<Agent, 'createdAt'>,
    useEIP712: boolean = false
  ): Promise<boolean> {
    if (!this.isConnected) {
      throw new Error('Not connected to blockchain');
    }

    try {
      // Ensure we have a connected wallet
      if (!window.ethereum) {
        throw new Error("No ethereum provider found. Please install MetaMask.");
      }

      // Re-connect with the signer to ensure we can send transactions
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contractWithSigner = new ethers.Contract(this.contract.target, ABI, signer);

      // Generate EIP-712 signature if requested
      if (useEIP712) {
        const agentData = {
          id: agent.id,
          name: agent.name,
          provider: agent.provider,
          version: agent.version
        };

        // Generate and add the EIP-712 signature
        const signatureData = await this.generateEIP712Signature(agentData);
        if (!signatureData) {
          throw new Error('Failed to generate EIP-712 signature');
        }

        // Store the signature data for later verification
        console.log('Generated EIP-712 signature:', signatureData);

        // In a production system, you might want to store this signature data
        // in a separate database table or in the smart contract itself
      }

      // Use the contract with signer to make the transaction
      const tx = await contractWithSigner.registerFingerprint(
        agent.id,
        agent.name,
        agent.provider,
        agent.version,
        agent.fingerprintHash
      );
      console.log("Transaction sent:", tx.hash);

      // Wait for transaction confirmation
      const receipt = await tx.wait();
      console.log("Transaction confirmed in block:", receipt.blockNumber);

      return true;
    } catch (error) {
      console.error('Failed to register fingerprint:', error);
      return false;
    }
  }

  public async verifyFingerprint(fingerprintHash: string): Promise<Agent | null> {
    if (!this.isConnected) {
      throw new Error('Not connected to blockchain');
    }

    try {
      console.log('Verifying fingerprint:', fingerprintHash);
      console.log('Contract address:', this.contract.target);
      // In ethers v6, the provider structure changed
      console.log('Provider connected:', this.isConnected);

      // For read operations, we can use our existing provider or create a new one
      // We'll use the contract as is since it's already connected to the provider
      const contract = this.contract;

      // Call the read-only function
      console.log('Calling contract.verifyFingerprint...');
      const result = await contract.verifyFingerprint(fingerprintHash);
      console.log('Raw verification result:', result);

      const [isVerified, id, name, provider_name, version, createdAt] = result;
      console.log('Parsed result - isVerified:', isVerified);

      if (!isVerified) {
        console.log('Fingerprint not verified - returning null');
        return null;
      }

      const agentData = {
        id,
        name,
        provider: provider_name,
        version,
        fingerprintHash,
        createdAt: Number(createdAt)
      };

      console.log('Verification successful, returning agent data:', agentData);
      return agentData;
    } catch (error) {
      console.error('Failed to verify fingerprint:', error);
      return null;
    }
  }

  /**
   * Generate a typed data signature for agent fingerprint using EIP-712
   * @param agent Agent information (without the fingerprint hash and createdAt)
   * @returns Object containing signature, signer address and timestamp
   */
  public async generateEIP712Signature(agent: Omit<Agent, 'createdAt' | 'fingerprintHash'>): Promise<SignatureData | null> {
    try {
      // Ensure we have a connected wallet
      if (!window.ethereum) {
        throw new Error("No ethereum provider found. Please install MetaMask.");
      }

      // Get the provider and signer
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();

      // Check if we're on the right network
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      const chainIdNumber = parseInt(chainId, 16);

      // Create the EIP-712 domain and message
      const domain = createEIP712Domain(chainIdNumber, this.contract.target as string);
      const message = createAgentFingerprintMessage(agent);

      // Sign the message
      const signature = await signAgentFingerprint(signer, domain, message);

      return {
        signature,
        signerAddress,
        timestamp: message.timestamp
      };
    } catch (error) {
      console.error('Failed to generate EIP-712 signature:', error);
      return null;
    }
  }

  /**
   * Verify an EIP-712 signature for an agent fingerprint
   * @param signature The signature to verify
   * @param agent The agent data
   * @param timestamp The timestamp when the signature was created
   * @returns The address that signed the message, or null if invalid
   */
  public verifyEIP712Signature(
    signature: string,
    agent: Omit<Agent, 'createdAt' | 'fingerprintHash'>,
    timestamp: number
  ): string | null {
    try {
      // Get the chainId from the configuration
      // Use the chainId from the BlockchainConfig to ensure backward compatibility
      const chainId = this.provider._network?.chainId || this.config.chainId;

      // Create the domain and message objects
      const domain = createEIP712Domain(chainId, this.contract.target as string);
      const message: AgentFingerprintMessage = {
        id: agent.id,
        name: agent.name,
        provider: agent.provider,
        version: agent.version,
        timestamp: timestamp
      };

      // Verify the signature
      return verifyAgentFingerprintSignature(signature, domain, message);
    } catch (error) {
      console.error('Failed to verify EIP-712 signature:', error);
      return null;
    }
  }
}
import { ethers } from 'ethers';
import { BlockchainConfig, Agent } from '../types';

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

  constructor(config: BlockchainConfig) {
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
      // This is a simplified example. In a real application, you would use Web3Modal or similar
      if (!window.ethereum) {
        throw new Error("No ethereum provider found. Please install MetaMask.");
      }

      // Request account access
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      
      // Create a new contract instance with the signer that can make write transactions
      this.contract = new ethers.Contract(this.contract.target, ABI, signer);
      
      const address = await signer.getAddress();
      console.log('Connected wallet address:', address);
      return address;
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      return null;
    }
  }

  public async registerFingerprint(agent: Omit<Agent, 'createdAt'>): Promise<boolean> {
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
      // For read operations, we can use our existing provider or create a new one
      // We'll use the contract as is since it's already connected to the provider
      const contract = this.contract;
      
      // Call the read-only function
      const [isVerified, id, name, provider_name, version, createdAt] = 
        await contract.verifyFingerprint(fingerprintHash);

      if (!isVerified) {
        return null;
      }

      return {
        id,
        name,
        provider: provider_name,
        version,
        fingerprintHash,
        createdAt: Number(createdAt)
      };
    } catch (error) {
      console.error('Failed to verify fingerprint:', error);
      return null;
    }
  }
}
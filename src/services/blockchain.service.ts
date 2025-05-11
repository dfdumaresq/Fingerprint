import { ethers } from 'ethers';
import { BlockchainConfig, Agent, SignatureData, RevocationData } from '../types';
import {
  createEIP712Domain,
  createAgentFingerprintMessage,
  signAgentFingerprint,
  verifyAgentFingerprintSignature,
  EIP712Domain,
  AgentFingerprintMessage,
  TypedData
} from '../utils/eip712.utils';
import {
  isEIP712Domain,
  isAgentFingerprintMessage,
  isValidEIP712Signature,
  validateAgentFingerprintMessage
} from '../utils/eip712.guards';
import {
  EIP712Error,
  EIP712SigningError,
  EIP712DomainError,
  EIP712MessageError,
  EIP712VerificationError,
  WalletNotConnectedError,
  UserRejectedSignatureError,
  isUserRejectionError,
  createProperError
} from '../utils/eip712.errors';

// Simple ABI for interacting with a smart contract that stores fingerprints
const ABI = [
  "function registerFingerprint(string id, string name, string provider, string version, string fingerprintHash) external",
  "function verifyFingerprint(string fingerprintHash) external view returns (bool isVerified, string id, string name, string provider, string version, uint256 createdAt)",
  "function revokeFingerprint(string fingerprintHash) external",
  "function isRevoked(string fingerprintHash) external view returns (bool revoked, uint256 revokedAt, address revokedBy)",
  "function verifyFingerprintExtended(string fingerprintHash) external view returns (bool isVerified, string id, string name, string provider, string version, uint256 createdAt, bool revoked, uint256 revokedAt)"
];

// Add Ethereum window type
declare global {
  interface Window {
    ethereum?: any;
  }
}

export class BlockchainService {
  private provider!: ethers.JsonRpcProvider;
  public contract!: ethers.Contract; // Changed to public to allow checking method existence
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
  public generateFingerprintHash(agent: Pick<Agent, 'id' | 'name' | 'provider' | 'version'>): string {
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
        throw new WalletNotConnectedError("No ethereum provider found. Please install MetaMask.");
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
        // Check if the user rejected the request
        if (isUserRejectionError(err)) {
          throw new UserRejectedSignatureError();
        }
        
        // Handle the case where the request is already in progress
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
      
      // Re-throw user rejection errors
      if (error instanceof UserRejectedSignatureError) {
        throw error;
      }
      
      this.isConnected = false;
      return null;
    }
  }

  /**
   * Register a fingerprint on the blockchain
   * @param agent Agent information including fingerprint hash
   * @param useEIP712 Whether to use EIP-712 typed data for signature
   * @returns Boolean indicating success or failure
   * @throws Various EIP712 errors if signing fails
   */
  public async registerFingerprint(
    agent: Omit<Agent, 'createdAt'>,
    useEIP712: boolean = false
  ): Promise<boolean> {
    if (!this.isConnected) {
      throw new WalletNotConnectedError('Not connected to blockchain');
    }

    try {
      // Ensure we have a connected wallet
      if (!window.ethereum) {
        throw new WalletNotConnectedError("No ethereum provider found. Please install MetaMask.");
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
          throw new EIP712SigningError('Failed to generate EIP-712 signature');
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
      // Check for specific error types
      if (isUserRejectionError(error)) {
        throw new UserRejectedSignatureError();
      }
      
      console.error('Failed to register fingerprint:', error);
      throw createProperError(error, 'Failed to register fingerprint');
    }
  }

  /**
   * Check if the current contract supports extended verification
   * @returns Boolean indicating whether extended verification is supported
   */
  public async supportsExtendedVerification(): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      // Try to call verifyFingerprintExtended with a dummy hash to see if it exists
      await this.contract.verifyFingerprintExtended('0x0000000000000000000000000000000000000000000000000000000000000000');
      return true;
    } catch (error: any) {
      // Check error message to distinguish between method not existing and other errors
      if (error.message && (
          error.message.includes("method not supported") ||
          error.message.includes("call revert exception") ||
          error.message.includes("function selector was not recognized") ||
          error.message.includes("not a function")
      )) {
        console.log('Contract does not support extended verification');
        return false;
      }

      // For other errors, we assume the method exists but failed for other reasons
      return true;
    }
  }

  public async verifyFingerprint(fingerprintHash: string): Promise<Agent | null> {
    if (!this.isConnected) {
      throw new WalletNotConnectedError('Not connected to blockchain');
    }

    try {
      console.log('Verifying fingerprint:', fingerprintHash);
      console.log('Contract address:', this.contract.target);
      console.log('Provider connected:', this.isConnected);

      // Check feature support
      const supportsRevocation = await this.supportsRevocation();
      const supportsExtendedVerification = await this.supportsExtendedVerification();

      console.log(`Contract capabilities: revocation=${supportsRevocation}, extendedVerification=${supportsExtendedVerification}`);

      // For read operations, we can use our existing provider
      const contract = this.contract;
      let result;
      let isExtendedVerificationUsed = false;

      // Try to use extended verification if supported
      if (supportsExtendedVerification) {
        try {
          console.log('Calling contract.verifyFingerprintExtended...');
          result = await contract.verifyFingerprintExtended(fingerprintHash);
          console.log('Raw extended verification result:', result);
          isExtendedVerificationUsed = true;
        } catch (err) {
          console.log('Extended verification failed, falling back to basic verification');
          isExtendedVerificationUsed = false;
        }
      }

      // Fall back to regular verification if needed
      if (!isExtendedVerificationUsed) {
        console.log('Calling contract.verifyFingerprint...');
        result = await contract.verifyFingerprint(fingerprintHash);
        console.log('Raw verification result:', result);
      }

      // Parse results based on which verification method was used
      let agentData: Agent;

      if (isExtendedVerificationUsed) {
        const [isVerified, id, name, provider_name, version, createdAt, revoked, revokedAt] = result;
        console.log('Parsed extended result - isVerified:', isVerified);

        if (!isVerified) {
          console.log('Fingerprint not verified - returning null');
          return null;
        }

        agentData = {
          id,
          name,
          provider: provider_name,
          version,
          fingerprintHash,
          createdAt: Number(createdAt),
          revoked,
          revokedAt: Number(revokedAt)
        };
      } else {
        const [isVerified, id, name, provider_name, version, createdAt] = result;
        console.log('Parsed basic result - isVerified:', isVerified);

        if (!isVerified) {
          console.log('Fingerprint not verified - returning null');
          return null;
        }

        agentData = {
          id,
          name,
          provider: provider_name,
          version,
          fingerprintHash,
          createdAt: Number(createdAt)
        };

        // Try to get revocation info separately if basic verification is used and revocation is supported
        if (supportsRevocation) {
          try {
            const revocationData = await this.isRevoked(fingerprintHash);
            if (revocationData) {
              agentData.revoked = revocationData.revoked;
              agentData.revokedAt = revocationData.revokedAt;
              agentData.revokedBy = revocationData.revokedBy;
            }
          } catch (revocationError) {
            console.log('Revocation check failed:', revocationError);
          }
        } else {
          console.log('Skipping revocation check - not supported by this contract');
        }
      }

      console.log('Verification successful, returning agent data:', agentData);
      return agentData;
    } catch (error) {
      console.error('Failed to verify fingerprint:', error);
      return null;
    }
  }

  /**
   * Revoke a fingerprint - can only be done by the original registrant
   * @param fingerprintHash The hash of the fingerprint to revoke
   * @returns Boolean indicating success or failure
   */
  public async revokeFingerprint(fingerprintHash: string): Promise<boolean> {
    if (!this.isConnected) {
      throw new WalletNotConnectedError('Not connected to blockchain');
    }

    try {
      // Instead of hardcoding addresses, check if the contract has the method
      // First check if isRevoked method exists - if not, this contract doesn't support revocation
      const supportsRevocation = await this.supportsRevocation();
      if (!supportsRevocation) {
        console.error('The deployed contract does not support revocation');
        throw new Error("The current contract deployment does not support revocation. This feature requires a contract upgrade.");
      }

      // Ensure we have a connected wallet
      if (!window.ethereum) {
        throw new WalletNotConnectedError("No ethereum provider found. Please install MetaMask.");
      }

      // Re-connect with the signer to ensure we can send transactions
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contractWithSigner = new ethers.Contract(this.contract.target, ABI, signer);

      // Use the contract with signer to make the transaction
      const tx = await contractWithSigner.revokeFingerprint(fingerprintHash);
      console.log("Revocation transaction sent:", tx.hash);

      // Wait for transaction confirmation
      const receipt = await tx.wait();
      console.log("Revocation transaction confirmed in block:", receipt.blockNumber);

      return true;
    } catch (error) {
      // Check for user rejection
      if (isUserRejectionError(error)) {
        throw new UserRejectedSignatureError();
      }
      
      console.error('Failed to revoke fingerprint:', error);
      return false;
    }
  }

  /**
   * Check if the current contract supports revocation functionality
   * @returns Boolean indicating whether revocation is supported
   */
  public async supportsRevocation(): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      // Try to call isRevoked function with a dummy hash to see if it exists
      // We're catching the error here but not acting on it
      // We only care if the method exists and can be called
      await this.contract.isRevoked('0x0000000000000000000000000000000000000000000000000000000000000000');
      return true;
    } catch (error: any) {
      // Check error message to distinguish between method not existing and other errors
      // If the error mentions something about the method not existing, it means the contract doesn't support it
      if (error.message && (
          error.message.includes("method not supported") ||
          error.message.includes("call revert exception") ||
          error.message.includes("function selector was not recognized") ||
          error.message.includes("not a function")
      )) {
        console.log('Contract does not support revocation');
        return false;
      }

      // For other types of errors, we assume the method exists but failed for other reasons
      // This is important because we don't want to incorrectly determine that revocation isn't supported
      return true;
    }
  }

  /**
   * Check if a fingerprint has been revoked
   * @param fingerprintHash The hash of the fingerprint to check
   * @returns RevocationData if revoked, null if not supported or not revoked
   */
  public async isRevoked(fingerprintHash: string): Promise<RevocationData | null> {
    if (!this.isConnected) {
      throw new WalletNotConnectedError('Not connected to blockchain');
    }

    try {
      // Check if revocation is supported by this contract
      const supportsRevocation = await this.supportsRevocation();
      if (!supportsRevocation) {
        console.log('Revocation functionality not supported on this contract');
        return null;
      }

      // Try to check revocation status
      try {
        const result = await this.contract.isRevoked(fingerprintHash);
        const [revoked, revokedAt, revokedBy] = result;

        if (revoked) {
          return {
            revoked,
            revokedAt: Number(revokedAt),
            revokedBy
          };
        } else {
          return null;  // Not revoked
        }
      } catch (methodError) {
        console.warn('Failed to check revocation status:', methodError);
        return null;
      }
    } catch (error) {
      console.error('Failed to check revocation status or not supported:', error);
      return null;
    }
  }

  /**
   * Generate a typed data signature for agent fingerprint using EIP-712
   * @param agent Agent information (without the fingerprint hash and createdAt)
   * @returns Object containing signature, signer address and timestamp
   * @throws EIP712Error if any part of the process fails
   */
  public async generateEIP712Signature(
    agent: Pick<Agent, 'id' | 'name' | 'provider' | 'version'>
  ): Promise<SignatureData> {
    try {
      // Ensure we have a connected wallet
      if (!window.ethereum) {
        throw new WalletNotConnectedError("No ethereum provider found. Please install MetaMask.");
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
      
      // Validate the domain
      if (!isEIP712Domain(domain)) {
        throw new EIP712DomainError('Invalid EIP-712 domain parameters', domain);
      }
      
      const message = createAgentFingerprintMessage(agent);
      
      // Validate the message
      const messageErrors = validateAgentFingerprintMessage(message);
      if (messageErrors.length > 0) {
        throw new EIP712MessageError(
          `Invalid EIP-712 message: ${messageErrors.join(', ')}`,
          message,
          messageErrors
        );
      }

      // Sign the message
      try {
        const signature = await signAgentFingerprint(signer, domain, message);
        
        // Validate the returned signature
        if (!isValidEIP712Signature(signature)) {
          throw new EIP712SigningError(`Invalid signature format: ${signature}`);
        }

        return {
          signature,
          signerAddress,
          timestamp: message.timestamp
        };
      } catch (error) {
        // Check if the user rejected the signing request
        if (isUserRejectionError(error)) {
          throw new UserRejectedSignatureError();
        }
        
        // Otherwise, wrap in a signing error
        throw new EIP712SigningError(
          'Failed to sign EIP-712 message',
          createProperError(error)
        );
      }
    } catch (error) {
      // Re-throw EIP712 errors
      if (error instanceof EIP712Error) {
        throw error;
      }
      
      console.error('Failed to generate EIP-712 signature:', error);
      throw new EIP712SigningError(
        'Failed to generate EIP-712 signature', 
        createProperError(error)
      );
    }
  }

  /**
   * Verify an EIP-712 signature for an agent fingerprint
   * @param signature The signature to verify
   * @param agent The agent data
   * @param timestamp The timestamp when the signature was created
   * @returns The address that signed the message, or null if invalid
   * @throws EIP712VerificationError if verification fails
   */
  public verifyEIP712Signature(
    signature: string,
    agent: Pick<Agent, 'id' | 'name' | 'provider' | 'version'>,
    timestamp: number
  ): string | null {
    try {
      // Validate signature format
      if (!isValidEIP712Signature(signature)) {
        throw new EIP712VerificationError(
          'Invalid EIP-712 signature format',
          signature
        );
      }
      
      // Get the chainId from the configuration
      // Use the chainId from the BlockchainConfig to ensure backward compatibility
      const chainId = this.provider._network?.chainId || this.config.chainId;

      // Create the domain and message objects
      const domain = createEIP712Domain(chainId, this.contract.target as string);
      
      // Validate domain
      if (!isEIP712Domain(domain)) {
        throw new EIP712DomainError('Invalid EIP-712 domain parameters', domain);
      }
      
      // Create message with provided timestamp
      const message: AgentFingerprintMessage = {
        id: agent.id,
        name: agent.name,
        provider: agent.provider,
        version: agent.version,
        timestamp: timestamp
      };
      
      // Validate message
      if (!isAgentFingerprintMessage(message)) {
        throw new EIP712MessageError('Invalid EIP-712 message format', message);
      }

      // Verify the signature
      return verifyAgentFingerprintSignature(signature, domain, message);
    } catch (error) {
      // Re-throw EIP712 errors
      if (error instanceof EIP712Error) {
        throw error;
      }
      
      console.error('Failed to verify EIP-712 signature:', error);
      return null;
    }
  }
}
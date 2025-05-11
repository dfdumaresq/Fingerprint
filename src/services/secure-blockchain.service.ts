import { ethers } from 'ethers';
import { BlockchainConfig, Agent, SignatureData, RevocationData } from '../types';
import {
  createEIP712Domain,
  createAgentFingerprintMessage,
  signAgentFingerprint,
  verifyAgentFingerprintSignature,
  EIP712Domain,
  AgentFingerprintMessage
} from '../utils/eip712.utils';
import { KeyManager, KeyType } from '../security/KeyManager';
import { AuditLogger, LogLevel, AuditEventType } from '../security/AuditLogger';

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

export class SecureBlockchainService {
  private provider!: ethers.JsonRpcProvider;
  public contract!: ethers.Contract;
  private isConnected: boolean = false;
  private config: BlockchainConfig;
  private keyManager: KeyManager;
  private auditLogger: AuditLogger;
  private connectedWalletAddress: string | null = null;
  private isRunningInBrowser: boolean;

  constructor(config: BlockchainConfig) {
    this.config = config;
    this.keyManager = KeyManager.getInstance();
    this.auditLogger = AuditLogger.getInstance();
    this.isRunningInBrowser = typeof window !== 'undefined' && window.ethereum !== undefined;
    
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

  /**
   * Connect to the wallet either in browser environment (using MetaMask) or in Node environment (using stored private key)
   * @param keyId Optional key ID to use for the wallet key (defaults to the default wallet key)
   * @returns Address of the connected wallet or null if connection failed
   */
  public async connectWallet(keyId?: string): Promise<string | null> {
    // Browser environment - use MetaMask or other injected provider
    if (this.isRunningInBrowser) {
      return this.connectBrowserWallet();
    } 
    // Node.js environment - use private key from secure storage
    else {
      return this.connectWalletWithStoredKey(keyId);
    }
  }

  /**
   * Connect to a wallet in the browser environment (via MetaMask)
   * @returns Connected wallet address or null
   * @private
   */
  private async connectBrowserWallet(): Promise<string | null> {
    try {
      console.log('Connecting wallet in browser environment...');
      if (!window.ethereum) {
        console.error('No ethereum provider found. Please install MetaMask.');
        throw new Error("No ethereum provider found. Please install MetaMask.");
      }

      console.log('Ethereum provider found, checking if already connected...');
      
      // Try to get accounts without showing the MetaMask popup first
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
          if (parseInt(chainId, 16) !== this.config.chainId) {
            console.error(`Please connect to the correct network (Chain ID: ${this.config.chainId})`);
            throw new Error(`Please connect to the correct network (Chain ID: ${this.config.chainId})`);
          }
          
          console.log('Creating new provider and signer...');
          const provider = new ethers.BrowserProvider(window.ethereum);
          const signer = await provider.getSigner();
          
          // Create a new contract instance with the signer that can make write transactions
          this.contract = new ethers.Contract(this.contract.target, ABI, signer);
          
          const address = await signer.getAddress();
          console.log('Connected wallet address:', address);
          this.isConnected = true;
          this.connectedWalletAddress = address;
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
      if (parseInt(chainId, 16) !== this.config.chainId) {
        console.error(`Please connect to the correct network (Chain ID: ${this.config.chainId})`);
        throw new Error(`Please connect to the correct network (Chain ID: ${this.config.chainId})`);
      }
      
      console.log('Creating new provider and signer...');
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      
      // Create a new contract instance with the signer that can make write transactions
      this.contract = new ethers.Contract(this.contract.target, ABI, signer);
      
      const address = await signer.getAddress();
      console.log('Connected wallet address:', address);
      this.isConnected = true;
      this.connectedWalletAddress = address;
      return address;
    } catch (error) {
      console.error('Failed to connect browser wallet:', error);
      this.isConnected = false;
      return null;
    }
  }

  /**
   * Connect to a wallet using a private key from secure storage
   * @param keyId Optional key ID to use for the wallet key
   * @returns Connected wallet address or null
   * @private
   */
  private async connectWalletWithStoredKey(keyId?: string): Promise<string | null> {
    try {
      console.log('Connecting wallet using stored private key...');
      
      // Get the wallet private key from secure storage
      const privateKey = await this.keyManager.getKey(KeyType.WALLET, keyId);
      if (!privateKey) {
        throw new Error('No wallet private key found in secure storage');
      }

      // Create a wallet instance from the private key
      const wallet = new ethers.Wallet(privateKey, this.provider);
      
      // Create a new contract instance with the wallet that can make write transactions
      this.contract = new ethers.Contract(this.contract.target, ABI, wallet);
      
      const address = await wallet.getAddress();
      console.log('Connected wallet address:', address);
      this.isConnected = true;
      this.connectedWalletAddress = address;

      // Log this access for audit purposes (without exposing the private key)
      this.auditLogger.logBlockchainTransaction(
        `Wallet connected using stored key`,
        address,
        this.contract.target as string,
        this.config.chainId,
        undefined,
        true,
        { keyId: keyId || 'default' }
      );
      
      return address;
    } catch (error) {
      console.error('Failed to connect with stored wallet key:', error);
      this.isConnected = false;
      return null;
    }
  }

  /**
   * Register a fingerprint on the blockchain
   * @param agent Agent information including fingerprint hash
   * @param useEIP712 Whether to use EIP-712 typed data for signature
   * @param keyId Optional key ID to use for signing (if not using browser wallet)
   * @returns Boolean indicating success or failure
   */
  public async registerFingerprint(
    agent: Omit<Agent, 'createdAt'>,
    useEIP712: boolean = false,
    keyId?: string
  ): Promise<boolean> {
    if (!this.isConnected) {
      throw new Error('Not connected to blockchain');
    }

    try {
      let contractWithSigner: ethers.Contract;
      
      // Determine how to sign the transaction based on environment
      if (this.isRunningInBrowser) {
        // In browser, ensure we have a connected wallet
        if (!window.ethereum) {
          throw new Error("No ethereum provider found. Please install MetaMask.");
        }

        // Re-connect with the signer to ensure we can send transactions
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        contractWithSigner = new ethers.Contract(this.contract.target, ABI, signer);
      } else {
        // In Node.js, use the wallet private key from secure storage
        if (!this.connectedWalletAddress) {
          await this.connectWalletWithStoredKey(keyId);
        }
        
        // We already have a contract with signer from the connectWalletWithStoredKey method
        contractWithSigner = this.contract;
      }

      // Generate EIP-712 signature if requested
      if (useEIP712) {
        const agentData = {
          id: agent.id,
          name: agent.name,
          provider: agent.provider,
          version: agent.version
        };

        // Generate and add the EIP-712 signature
        const signatureData = await this.generateEIP712Signature(agentData, keyId);
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

      // Log the successful registration
      this.auditLogger.logBlockchainTransaction(
        `Registered fingerprint`,
        this.connectedWalletAddress || 'unknown',
        this.contract.target as string,
        this.config.chainId,
        tx.hash,
        true,
        {
          fingerprintHash: agent.fingerprintHash,
          agentId: agent.id,
          blockNumber: receipt.blockNumber
        }
      );

      return true;
    } catch (error) {
      console.error('Failed to register fingerprint:', error);
      return false;
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
      throw new Error('Not connected to blockchain');
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

      // Log the verification (whether successful or not)
      this.auditLogger.logBlockchainTransaction(
        `Verified fingerprint`,
        this.connectedWalletAddress || 'unknown',
        this.contract.target as string,
        this.config.chainId,
        undefined,
        true,
        {
          fingerprintHash,
          verificationResult: !!agentData,
          agentData: agentData ? {
            id: agentData.id,
            name: agentData.name,
            provider: agentData.provider,
            version: agentData.version,
            revoked: agentData.revoked
          } : null
        }
      );

      console.log('Verification successful, returning agent data:', agentData);
      return agentData;
    } catch (error) {
      console.error('Failed to verify fingerprint:', error);
      return null;
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
      await this.contract.isRevoked('0x0000000000000000000000000000000000000000000000000000000000000000');
      return true;
    } catch (error: any) {
      // Check error message to distinguish between method not existing and other errors
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
      return true;
    }
  }

  /**
   * Revoke a fingerprint - can only be done by the original registrant or contract owner
   * @param fingerprintHash The hash of the fingerprint to revoke
   * @param keyId Optional key ID to use for signing (if not using browser wallet)
   * @returns Boolean indicating success or failure
   */
  public async revokeFingerprint(fingerprintHash: string, keyId?: string): Promise<boolean> {
    if (!this.isConnected) {
      throw new Error('Not connected to blockchain');
    }

    try {
      // Check if the contract supports revocation
      const supportsRevocation = await this.supportsRevocation();
      if (!supportsRevocation) {
        console.error('The deployed contract does not support revocation');
        throw new Error("The current contract deployment does not support revocation. This feature requires a contract upgrade.");
      }

      let contractWithSigner: ethers.Contract;
      
      // Determine how to sign the transaction based on environment
      if (this.isRunningInBrowser) {
        // In browser, ensure we have a connected wallet
        if (!window.ethereum) {
          throw new Error("No ethereum provider found. Please install MetaMask.");
        }

        // Re-connect with the signer to ensure we can send transactions
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        contractWithSigner = new ethers.Contract(this.contract.target, ABI, signer);
      } else {
        // In Node.js, use the wallet private key from secure storage
        if (!this.connectedWalletAddress) {
          await this.connectWalletWithStoredKey(keyId);
        }
        
        // We already have a contract with signer from the connectWalletWithStoredKey method
        contractWithSigner = this.contract;
      }

      // Use the contract with signer to make the transaction
      const tx = await contractWithSigner.revokeFingerprint(fingerprintHash);
      console.log("Revocation transaction sent:", tx.hash);

      // Wait for transaction confirmation
      const receipt = await tx.wait();
      console.log("Revocation transaction confirmed in block:", receipt.blockNumber);

      // Log the revocation for audit purposes
      this.auditLogger.logBlockchainTransaction(
        `Revoked fingerprint`,
        this.connectedWalletAddress || 'unknown',
        this.contract.target as string,
        this.config.chainId,
        tx.hash,
        true,
        {
          fingerprintHash,
          blockNumber: receipt.blockNumber
        }
      );

      return true;
    } catch (error) {
      console.error('Failed to revoke fingerprint:', error);
      return false;
    }
  }

  /**
   * Check if a fingerprint has been revoked
   * @param fingerprintHash The hash of the fingerprint to check
   * @returns RevocationData if revoked, null if not supported or not revoked
   */
  public async isRevoked(fingerprintHash: string): Promise<RevocationData | null> {
    if (!this.isConnected) {
      throw new Error('Not connected to blockchain');
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
   * @param keyId Optional key ID to use for signing (if not using browser wallet)
   * @returns Object containing signature, signer address and timestamp
   */
  public async generateEIP712Signature(
    agent: Omit<Agent, 'createdAt' | 'fingerprintHash'>,
    keyId?: string
  ): Promise<SignatureData | null> {
    try {
      let signature: string;
      let signerAddress: string;
      
      // Create the EIP-712 domain and message
      const chainId = this.config.chainId;
      const domain = createEIP712Domain(chainId, this.contract.target as string);
      const message = createAgentFingerprintMessage(agent);

      // Determine how to sign the message based on environment
      if (this.isRunningInBrowser) {
        // In browser environment, use MetaMask or other wallet
        if (!window.ethereum) {
          throw new Error("No ethereum provider found. Please install MetaMask.");
        }

        // Get the provider and signer
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        signerAddress = await signer.getAddress();

        // Sign the message using the browser wallet
        signature = await signAgentFingerprint(signer, domain, message);
      } else {
        // In Node.js environment, use the stored private key
        // Get the signing key from secure storage
        const privateKey = await this.keyManager.getKey(KeyType.SIGNING, keyId);
        if (!privateKey) {
          throw new Error('No signing key found in secure storage');
        }
        
        // Create a wallet from the private key
        const wallet = new ethers.Wallet(privateKey);
        signerAddress = await wallet.getAddress();
        
        // Sign the message using the wallet
        signature = await signAgentFingerprint(wallet, domain, message);
        
        // Log this signing operation for audit purposes (without exposing the private key)
        this.auditLogger.logSignatureEvent(
          true, // isGeneration
          `Generated EIP-712 signature`,
          signerAddress,
          'AgentFingerprint',
          true, // success
          {
            keyId: keyId || 'default',
            timestamp: message.timestamp,
            agent: {
              id: agent.id,
              name: agent.name,
              provider: agent.provider,
              version: agent.version
            }
          }
        );
      }

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
      const chainId = this.config.chainId;

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
      const recoveredAddress = verifyAgentFingerprintSignature(signature, domain, message);
      
      // Log this verification for audit purposes
      this.auditLogger.logSignatureEvent(
        false, // isGeneration
        `Verified EIP-712 signature`,
        recoveredAddress || 'invalid',
        'AgentFingerprint',
        !!recoveredAddress, // success
        {
          timestamp,
          verified: !!recoveredAddress,
          agent: {
            id: agent.id,
            name: agent.name,
            provider: agent.provider,
            version: agent.version
          }
        }
      );
      
      return recoveredAddress;
    } catch (error) {
      console.error('Failed to verify EIP-712 signature:', error);
      return null;
    }
  }

}
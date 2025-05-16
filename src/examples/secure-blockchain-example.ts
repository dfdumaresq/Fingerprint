/**
 * Example usage of the SecureBlockchainService with KeyManager integration
 * 
 * This example demonstrates how to:
 * 1. Initialize the security system
 * 2. Use the secure blockchain service in both browser and Node.js environments
 * 3. Register fingerprints with secure key storage
 * 4. Verify fingerprints and signatures
 * 5. Revoke fingerprints
 */

import { SecureBlockchainService } from '../services/secure-blockchain.service';
import Security, { KeyType, LogLevel, AuditEventType } from '../security';
import { Agent } from '../types';

// Configuration values (would normally come from environment variables)
const networkUrl = 'https://sepolia.infura.io/v3/your-infura-key';
const contractAddress = '0xYourContractAddressHere';
const chainId = 11155111; // Sepolia testnet

/**
 * Example function for initializing the system
 */
async function initializeSystem() {
  console.log('Initializing security system...');
  
  // Initialize security with a master password (in production, this would come from a secure source)
  // Never hard-code passwords in a real application
  const masterPassword = typeof process !== 'undefined' && process.env && process.env.MASTER_KEY_PASSWORD
    ? process.env.MASTER_KEY_PASSWORD
    : 'development_only_password';
  const environment = typeof process !== 'undefined' && process.env && process.env.NODE_ENV
    ? process.env.NODE_ENV
    : 'development';
  
  // Initialize the security system
  Security.initialize(masterPassword, environment);
  
  console.log('Security system initialized.');
}

/**
 * Example of storing keys for blockchain operations
 */
async function setupSecureKeys() {
  console.log('Setting up secure keys...');
  
  const keyManager = Security.keyManager;
  
  // Store a wallet key (in production, would come from a secure source)
  try {
    // Check if we already have a wallet key
    const existingKeys = await keyManager.listKeys(KeyType.WALLET);
    if (existingKeys.length === 0) {
      // Example private key - NEVER use this in production or expose real keys in code
      // This is a hardcoded example only for demonstration
      const examplePrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
      
      // Store the key with metadata
      const keyId = await keyManager.storeKey(KeyType.WALLET, examplePrivateKey, {
        keyId: 'example_wallet_key',
        tags: {
          keyType: KeyType.WALLET.toString(),
          environment: 'development',
          purpose: 'example',
          description: 'Example wallet key for development only'
        },
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30) // 30 days
      });
      
      console.log(`Created new wallet key with ID: ${keyId}`);
    } else {
      console.log(`Using existing wallet key: ${existingKeys[0].keyId}`);
    }
    
    // Store a signing key for EIP-712 signatures
    const existingSigningKeys = await keyManager.listKeys(KeyType.SIGNING);
    if (existingSigningKeys.length === 0) {
      // Example private key - NEVER use this in production
      const exampleSigningKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
      
      // Store the key with metadata
      const keyId = await keyManager.storeKey(KeyType.SIGNING, exampleSigningKey, {
        keyId: 'example_signing_key',
        tags: {
          keyType: KeyType.SIGNING.toString(),
          environment: 'development',
          purpose: 'example',
          description: 'Example signing key for development only'
        },
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30) // 30 days
      });
      
      console.log(`Created new signing key with ID: ${keyId}`);
    } else {
      console.log(`Using existing signing key: ${existingSigningKeys[0].keyId}`);
    }
  } catch (error: any) {
    console.error('Error setting up secure keys:', error);
  }
}

/**
 * Example of using the SecureBlockchainService in Node.js
 */
async function exampleNodeUsage() {
  try {
    console.log('Running blockchain service example in Node.js environment...');
    
    // Create the blockchain service with configuration
    const blockchainService = new SecureBlockchainService({
      networkUrl,
      contractAddress,
      chainId,
      name: 'sepolia'
    });
    
    // Connect to wallet using stored key
    const walletAddress = await blockchainService.connectWallet('example_wallet_key');
    if (!walletAddress) {
      throw new Error('Failed to connect wallet');
    }
    
    console.log(`Connected to wallet with address: ${walletAddress}`);
    
    // Define an example agent
    const agent: Omit<Agent, 'createdAt' | 'fingerprintHash'> = {
      id: 'example-agent-id',
      name: 'Example Agent',
      provider: 'Example Provider',
      version: '1.0.0'
    };
    
    // Generate a fingerprint hash
    const fingerprintHash = blockchainService.generateFingerprintHash(agent);
    console.log(`Generated fingerprint hash: ${fingerprintHash}`);
    
    // Generate an EIP-712 signature using secure key storage
    const signatureData = await blockchainService.generateEIP712Signature(
      agent,
      'example_signing_key'
    );
    
    if (!signatureData) {
      throw new Error('Failed to generate EIP-712 signature');
    }
    
    console.log(`Generated EIP-712 signature: ${signatureData.signature.slice(0, 20)}...`);
    console.log(`Signer address: ${signatureData.signerAddress}`);
    
    // Verify the signature
    const recoveredAddress = blockchainService.verifyEIP712Signature(
      signatureData.signature,
      agent,
      signatureData.timestamp
    );
    
    console.log(`Verified signature, recovered address: ${recoveredAddress}`);
    
    // In a real application, we would now register the fingerprint on the blockchain
    // This is commented out to avoid actual blockchain transactions in the example
    /*
    const registrationResult = await blockchainService.registerFingerprint(
      {
        ...agent,
        fingerprintHash
      },
      true, // Use EIP-712
      'example_wallet_key'
    );
    
    if (registrationResult) {
      console.log('Successfully registered fingerprint on the blockchain');
    } else {
      console.error('Failed to register fingerprint');
    }
    */
    
    console.log('Node.js example completed successfully');
  } catch (error: any) {
    console.error('Error in Node.js example:', error);
  }
}

/**
 * Example of using the SecureBlockchainService in a browser
 * 
 * Note: This example is designed to be run in a browser environment.
 * In a typical application, this would be part of a React component
 * or other browser-based code.
 */
async function exampleBrowserUsage() {
  // For demonstration purposes, this is just a shell that would be run in a browser
  console.log('Browser example would connect to MetaMask and use the browser wallet');
  console.log('This example is intended to be adapted into a web application component');
  
  // In a browser environment, you would initialize the service and connect to the browser wallet:
  /*
  // Create the blockchain service with configuration
  const blockchainService = new SecureBlockchainService({
    networkUrl,
    contractAddress,
    chainId
  });
  
  // Connect to the browser wallet (MetaMask)
  try {
    const walletAddress = await blockchainService.connectWallet();
    if (walletAddress) {
      console.log(`Connected to browser wallet: ${walletAddress}`);
      
      // Define an example agent
      const agent = {
        id: 'example-browser-agent',
        name: 'Browser Agent',
        provider: 'Browser Provider',
        version: '1.0.0'
      };
      
      // Generate a fingerprint hash
      const fingerprintHash = blockchainService.generateFingerprintHash(agent);
      
      // Register the fingerprint (would prompt user for transaction approval)
      const registrationResult = await blockchainService.registerFingerprint(
        {
          ...agent,
          fingerprintHash
        },
        true // Use EIP-712
      );
      
      if (registrationResult) {
        console.log('Successfully registered fingerprint on the blockchain');
      }
    }
  } catch (error) {
    console.error('Error connecting to browser wallet:', error);
  }
  */
}

/**
 * Example function for listing and managing keys
 */
async function exampleKeyManagement() {
  try {
    console.log('Running key management example...');
    
    const keyManager = Security.keyManager;
    
    // List all wallet keys
    const walletKeys = await keyManager.listKeys(KeyType.WALLET);
    console.log(`Found ${walletKeys.length} wallet keys:`);
    walletKeys.forEach(key => {
      console.log(`- ${key.keyId}: Created at ${key.createdAt}, expires at ${key.expiresAt || 'never'}`);
    });
    
    // List all signing keys
    const signingKeys = await keyManager.listKeys(KeyType.SIGNING);
    console.log(`Found ${signingKeys.length} signing keys:`);
    signingKeys.forEach(key => {
      console.log(`- ${key.keyId}: Created at ${key.createdAt}, expires at ${key.expiresAt || 'never'}`);
    });
    
    // Rotate a key (in a real application)
    if (walletKeys.length > 0) {
      console.log(`Would rotate key: ${walletKeys[0].keyId}`);
      // In a real application, you would uncomment this:
      // const newKeyId = await keyManager.rotateKey(KeyType.WALLET, walletKeys[0].keyId);
      // console.log(`Rotated key, new key ID: ${newKeyId}`);
    }
  } catch (error: any) {
    console.error('Error in key management example:', error);
  }
}

/**
 * Example function for viewing audit logs
 */
async function exampleAuditLogs() {
  console.log('Viewing audit logs example...');
  
  const auditLogger = Security.auditLogger;
  
  // In a real application, you would retrieve logs from storage
  // This example just manually logs some events for demonstration
  
  // Log a few example events
  auditLogger.log(
    LogLevel.INFO,
    AuditEventType.ADMIN_ACTION,
    'User requested audit logs',
    'admin@example.com',
    'audit_log_system',
    'success'
  );
  
  auditLogger.logKeyAccess(
    KeyType.WALLET,
    'example_wallet_key',
    'system',
    'key_export',
    false // boolean value for success parameter
  );
  
  auditLogger.logBlockchainTransaction(
    'Query contract state',
    '0xExampleUserAddress',
    contractAddress,
    chainId,
    undefined,
    true,
    { method: 'verifyFingerprint', params: ['0xExampleFingerprintHash'] }
  );
  
  console.log('In a real application, these logs would be stored securely and retrievable');
}

/**
 * Main example runner function
 */
async function runExamples() {
  try {
    // Initialize the security system first
    await initializeSystem();
    
    // Setup secure keys
    await setupSecureKeys();
    
    // Run the Node.js example
    await exampleNodeUsage();
    
    // Show the browser example (for informational purposes)
    await exampleBrowserUsage();
    
    // Demonstrate key management
    await exampleKeyManagement();
    
    // Demonstrate audit logging
    await exampleAuditLogs();
    
    console.log('All examples completed successfully');
  } catch (error: any) {
    console.error('Error running examples:', error);
  }
}

// In a real application, you would call this based on user interaction
// For this example, we'll leave it as a callable function
// runExamples().catch(console.error);

export { runExamples, initializeSystem, setupSecureKeys, exampleNodeUsage, exampleBrowserUsage, exampleKeyManagement, exampleAuditLogs };

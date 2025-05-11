# Secure Key Management & Blockchain Integration

This module provides secure key management and blockchain integration for the Fingerprint application, following OWASP key management guidelines.

## Overview

The security module consists of several components:

1. **Key Management System**: Securely stores and manages cryptographic keys
2. **Audit Logging**: Records security-related events for auditing and compliance
3. **Secure Blockchain Service**: Integrates with the key management system for blockchain operations

## Key Management Features

- Key isolation through interfaces and abstraction
- Multiple storage backends (environment variables, encrypted files, vault services)
- Secure key rotation and lifecycle management
- Key metadata tracking and expiration policies
- Support for different key types (deployment, wallet, signing, API)
- Factory pattern for different provider strategies
- Password-based key derivation for encryption
- Audit logging of key access
- Secure integration with blockchain operations

## Usage

### Initializing the Security System

```typescript
import Security from './security';

// Initialize with master password and environment
Security.initialize('your-master-password', 'development');

// Access components individually if needed
const keyManager = Security.keyManager;
const auditLogger = Security.auditLogger;
```

### Working with Keys

```typescript
import { KeyType } from './security';

// Store a new key
const keyId = await keyManager.storeKey(
  KeyType.WALLET,
  'private-key-content',
  {
    keyId: 'my-wallet-key',
    tags: {
      purpose: 'transaction-signing',
      environment: 'development'
    },
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() // 90 days
  }
);

// Retrieve a key
const privateKey = await keyManager.getKey(KeyType.WALLET, 'my-wallet-key');

// List keys
const walletKeys = await keyManager.listKeys(KeyType.WALLET);

// Rotate a key
const newKeyId = await keyManager.rotateKey(KeyType.WALLET, 'my-wallet-key');

// Delete a key
await keyManager.deleteKey(KeyType.WALLET, 'my-wallet-key');
```

### Using the Secure Blockchain Service

```typescript
import { SecureBlockchainService } from '../services/secure-blockchain.service';

// Create a blockchain service instance
const blockchainService = new SecureBlockchainService({
  networkUrl: 'https://sepolia.infura.io/v3/your-infura-key',
  contractAddress: '0xYourContractAddress',
  chainId: 11155111 // Sepolia testnet
});

// Connect with a wallet from secure storage in Node.js environment
const walletAddress = await blockchainService.connectWallet('my-wallet-key');

// Or connect with MetaMask in browser environment (no key ID needed)
const browserWalletAddress = await blockchainService.connectWallet();

// Generate EIP-712 signature using secure key storage
const signatureData = await blockchainService.generateEIP712Signature(
  {
    id: 'agent-id',
    name: 'Agent Name',
    provider: 'Provider Name',
    version: '1.0.0'
  },
  'my-signing-key'
);

// Register a fingerprint on the blockchain
const fingerprintHash = blockchainService.generateFingerprintHash({
  id: 'agent-id',
  name: 'Agent Name',
  provider: 'Provider Name',
  version: '1.0.0'
});

await blockchainService.registerFingerprint(
  {
    id: 'agent-id',
    name: 'Agent Name',
    provider: 'Provider Name',
    version: '1.0.0',
    fingerprintHash
  },
  true, // Use EIP-712 signing
  'my-wallet-key'
);

// Verify a fingerprint
const agentData = await blockchainService.verifyFingerprint(fingerprintHash);

// Revoke a fingerprint
await blockchainService.revokeFingerprint(fingerprintHash, 'my-wallet-key');
```

### Audit Logging

```typescript
import { LogLevel, AuditEventType } from './security';

// Log a security event
auditLogger.log(
  LogLevel.INFO,
  AuditEventType.KEY_ACCESS,
  'User exported key',
  'user@example.com',
  'key-id',
  'success'
);

// Log a blockchain transaction
auditLogger.logBlockchainTransaction(
  'Register fingerprint',
  '0xUserWalletAddress',
  '0xContractAddress',
  11155111, // Chain ID
  '0xTransactionHash',
  true, // Success
  { fingerprintHash: '0xFingerprintHash' }
);

// Log a signature event
auditLogger.logSignatureEvent(
  true, // isGeneration
  'Generate EIP-712 signature',
  '0xSignerAddress',
  'AgentFingerprint',
  true, // Success
  { timestamp: Date.now() }
);
```

### Environment Detection

The `SecureBlockchainService` automatically detects whether it's running in a browser or Node.js environment:

- In browser environments, it uses MetaMask or other injected providers
- In Node.js environments, it uses stored private keys from the key management system

## Security Considerations

1. **Master Password**: The master password must be securely provided to the application. Never hard-code it in your source code.

2. **Environment Variables**: While environment variables are supported for backward compatibility, they are only recommended for development environments.

3. **Key Rotation**: Implement a key rotation policy to regularly rotate keys, especially for production environments.

4. **Production Settings**: For production deployments, configure the key manager to use a vault service like HashiCorp Vault or AWS KMS.

5. **Audit Logs**: Configure remote logging for production to ensure logs are securely stored and cannot be tampered with.

## Example

See the `/src/examples/secure-blockchain-example.ts` file for a complete example of using the security system.
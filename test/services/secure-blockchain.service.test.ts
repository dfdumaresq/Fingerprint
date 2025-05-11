import { describe, expect, it, beforeEach, jest, afterEach } from '@jest/globals';
import { SecureBlockchainService } from '../../src/services/secure-blockchain.service';
import { BlockchainConfig, Agent } from '../../src/types';
import { KeyManager, KeyType } from '../../src/security/KeyManager';
import { AuditLogger } from '../../src/security/AuditLogger';
import { MockKeyProvider } from '../mocks/MockKeyProvider';

// Mock ethers.js
jest.mock('ethers', () => {
  const originalModule = jest.requireActual('ethers');
  
  return {
    ...originalModule,
    JsonRpcProvider: jest.fn().mockImplementation(() => ({
      _network: { chainId: 11155111 }
    })),
    Contract: jest.fn().mockImplementation(() => ({
      target: '0x1234567890123456789012345678901234567890',
      verifyFingerprint: jest.fn(),
      verifyFingerprintExtended: jest.fn(),
      isRevoked: jest.fn(),
      registerFingerprint: jest.fn(),
      revokeFingerprint: jest.fn()
    })),
    BrowserProvider: jest.fn().mockImplementation(() => ({
      getSigner: jest.fn().mockResolvedValue({
        getAddress: jest.fn().mockResolvedValue('0x1234567890123456789012345678901234567890'),
        signTypedData: jest.fn().mockResolvedValue('0xsignature')
      })
    })),
    Wallet: jest.fn().mockImplementation(() => ({
      connect: jest.fn().mockReturnThis(),
      getAddress: jest.fn().mockResolvedValue('0x1234567890123456789012345678901234567890'),
      signTypedData: jest.fn().mockResolvedValue('0xsignature')
    })),
    toUtf8Bytes: jest.fn().mockReturnValue(new Uint8Array()),
    keccak256: jest.fn().mockReturnValue('0xhash'),
    verifyTypedData: jest.fn().mockReturnValue('0x1234567890123456789012345678901234567890')
  };
});

// Mock KeyManager and AuditLogger
jest.mock('../../src/security/KeyManager');
jest.mock('../../src/security/AuditLogger');

// Mock window.ethereum for browser tests
Object.defineProperty(global, 'window', {
  value: {},
  writable: true
});

describe('SecureBlockchainService', () => {
  let service: SecureBlockchainService;
  let mockConfig: BlockchainConfig;
  let mockKeyManager: jest.Mocked<KeyManager>;
  let mockAuditLogger: jest.Mocked<AuditLogger>;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create mock configuration
    mockConfig = {
      networkUrl: 'https://example.com',
      chainId: 11155111,
      contractAddress: '0x1234567890123456789012345678901234567890'
    };
    
    // Set up mocked KeyManager
    mockKeyManager = KeyManager.getInstance() as jest.Mocked<KeyManager>;
    
    // Set up mocked AuditLogger
    mockAuditLogger = AuditLogger.getInstance() as jest.Mocked<AuditLogger>;
    
    // Create service
    service = new SecureBlockchainService(mockConfig);
  });
  
  afterEach(() => {
    // Reset window for clean tests
    delete (global.window as any).ethereum;
  });
  
  describe('Environment Detection', () => {
    it('should detect Node.js environment when window is undefined', () => {
      // Temporarily remove window
      const originalWindow = global.window;
      (global as any).window = undefined;
      
      // Create service in Node.js environment
      const nodeService = new SecureBlockchainService(mockConfig);
      
      // Verify it's detected as not running in browser
      expect((nodeService as any).isRunningInBrowser).toBe(false);
      
      // Restore window
      global.window = originalWindow;
    });
    
    it('should detect browser environment when window.ethereum exists', () => {
      // Set up browser environment
      (global.window as any).ethereum = {
        request: jest.fn()
      };
      
      // Create service in browser environment
      const browserService = new SecureBlockchainService(mockConfig);
      
      // Verify it's detected as running in browser
      expect((browserService as any).isRunningInBrowser).toBe(true);
    });
  });
  
  describe('Wallet Connection', () => {
    it('should connect using stored key in Node.js environment', async () => {
      // Set up as Node.js environment
      (service as any).isRunningInBrowser = false;
      
      // Mock key retrieval
      mockKeyManager.getKey.mockResolvedValue('0xprivatekey');
      
      // Connect wallet
      const address = await service.connectWallet('test-wallet-key');
      
      // Check that key was requested
      expect(mockKeyManager.getKey).toHaveBeenCalledWith(KeyType.WALLET, 'test-wallet-key');
      
      // Check that wallet was created
      expect(require('ethers').Wallet).toHaveBeenCalledWith('0xprivatekey', expect.anything());
      
      // Check that address was returned
      expect(address).toBe('0x1234567890123456789012345678901234567890');
      
      // Check that audit log was created
      expect(mockAuditLogger.logBlockchainTransaction).toHaveBeenCalled();
    });
    
    it('should connect using browser wallet in browser environment', async () => {
      // Set up as browser environment
      (service as any).isRunningInBrowser = true;
      
      // Set up window.ethereum
      (global.window as any).ethereum = {
        request: jest.fn().mockImplementation((obj) => {
          if (obj.method === 'eth_chainId') return '0xaa36a7'; // Sepolia testnet in hex
          if (obj.method === 'eth_accounts' || obj.method === 'eth_requestAccounts') {
            return ['0x1234567890123456789012345678901234567890'];
          }
          return null;
        })
      };
      
      // Connect wallet
      const address = await service.connectWallet();
      
      // Check that ethereum.request was called
      expect((global.window as any).ethereum.request).toHaveBeenCalled();
      
      // Check that BrowserProvider was created
      expect(require('ethers').BrowserProvider).toHaveBeenCalledWith((global.window as any).ethereum);
      
      // Check that address was returned
      expect(address).toBe('0x1234567890123456789012345678901234567890');
    });
  });
  
  describe('Blockchain Operations', () => {
    // Sample agent data
    const sampleAgent: Omit<Agent, 'createdAt'> = {
      id: 'test-agent',
      name: 'Test Agent',
      provider: 'Test Provider',
      version: '1.0.0',
      fingerprintHash: '0xtesthash'
    };
    
    beforeEach(() => {
      // Set up as Node.js environment
      (service as any).isRunningInBrowser = false;
      
      // Mock wallet connection
      (service as any).connectedWalletAddress = '0x1234567890123456789012345678901234567890';
      
      // Mock contract methods
      (service as any).contract.registerFingerprint.mockResolvedValue({
        hash: '0xtxhash',
        wait: jest.fn().mockResolvedValue({ blockNumber: 123456 })
      });
      
      (service as any).contract.verifyFingerprintExtended.mockResolvedValue([
        true, 'test-agent', 'Test Agent', 'Test Provider', '1.0.0', 123456789, false, 0
      ]);
      
      (service as any).contract.isRevoked.mockResolvedValue([false, 0, '0x0000000000000000000000000000000000000000']);
      
      (service as any).contract.revokeFingerprint.mockResolvedValue({
        hash: '0xrevoketxhash',
        wait: jest.fn().mockResolvedValue({ blockNumber: 123457 })
      });
    });
    
    it('should register fingerprint with secure key', async () => {
      // Mock key retrieval
      mockKeyManager.getKey.mockResolvedValue('0xprivatekey');
      
      // Register fingerprint
      const result = await service.registerFingerprint(sampleAgent, false, 'test-wallet-key');
      
      // Check that key was requested
      expect(mockKeyManager.getKey).toHaveBeenCalledWith(KeyType.WALLET, 'test-wallet-key');
      
      // Check that contract method was called
      expect((service as any).contract.registerFingerprint).toHaveBeenCalledWith(
        sampleAgent.id,
        sampleAgent.name,
        sampleAgent.provider,
        sampleAgent.version,
        sampleAgent.fingerprintHash
      );
      
      // Check that result is true
      expect(result).toBe(true);
      
      // Check that audit log was created
      expect(mockAuditLogger.logBlockchainTransaction).toHaveBeenCalled();
    });
    
    it('should verify fingerprint with extended verification', async () => {
      // Verify fingerprint
      const result = await service.verifyFingerprint('0xtesthash');
      
      // Check that contract method was called
      expect((service as any).contract.verifyFingerprintExtended).toHaveBeenCalledWith('0xtesthash');
      
      // Check that result contains agent data
      expect(result).toEqual({
        id: 'test-agent',
        name: 'Test Agent',
        provider: 'Test Provider',
        version: '1.0.0',
        fingerprintHash: '0xtesthash',
        createdAt: 123456789,
        revoked: false,
        revokedAt: 0
      });
      
      // Check that audit log was created
      expect(mockAuditLogger.logBlockchainTransaction).toHaveBeenCalled();
    });
    
    it('should revoke fingerprint with secure key', async () => {
      // Mock key retrieval
      mockKeyManager.getKey.mockResolvedValue('0xprivatekey');
      
      // Mock supportsRevocation method
      jest.spyOn(service, 'supportsRevocation').mockResolvedValue(true);
      
      // Revoke fingerprint
      const result = await service.revokeFingerprint('0xtesthash', 'test-wallet-key');
      
      // Check that key was requested
      expect(mockKeyManager.getKey).toHaveBeenCalledWith(KeyType.WALLET, 'test-wallet-key');
      
      // Check that contract method was called
      expect((service as any).contract.revokeFingerprint).toHaveBeenCalledWith('0xtesthash');
      
      // Check that result is true
      expect(result).toBe(true);
      
      // Check that audit log was created
      expect(mockAuditLogger.logBlockchainTransaction).toHaveBeenCalled();
    });
  });
  
  describe('EIP-712 Signatures', () => {
    const sampleAgent: Omit<Agent, 'createdAt' | 'fingerprintHash'> = {
      id: 'test-agent',
      name: 'Test Agent',
      provider: 'Test Provider',
      version: '1.0.0'
    };
    
    beforeEach(() => {
      // Set up as Node.js environment
      (service as any).isRunningInBrowser = false;
    });
    
    it('should generate EIP-712 signature with secure key', async () => {
      // Mock key retrieval
      mockKeyManager.getKey.mockResolvedValue('0xprivatekey');
      
      // Generate signature
      const result = await service.generateEIP712Signature(sampleAgent, 'test-signing-key');
      
      // Check that key was requested
      expect(mockKeyManager.getKey).toHaveBeenCalledWith(KeyType.SIGNING, 'test-signing-key');
      
      // Check that wallet was created
      expect(require('ethers').Wallet).toHaveBeenCalledWith('0xprivatekey');
      
      // Check that signature was generated
      expect(result).toEqual({
        signature: '0xsignature',
        signerAddress: '0x1234567890123456789012345678901234567890',
        timestamp: expect.any(Number)
      });
      
      // Check that audit log was created
      expect(mockAuditLogger.logSignatureEvent).toHaveBeenCalled();
    });
    
    it('should verify EIP-712 signature', () => {
      // Verify signature
      const result = service.verifyEIP712Signature(
        '0xsignature',
        sampleAgent,
        123456789
      );
      
      // Check that verifyTypedData was called
      expect(require('ethers').verifyTypedData).toHaveBeenCalled();
      
      // Check that result is the recovered address
      expect(result).toBe('0x1234567890123456789012345678901234567890');
      
      // Check that audit log was created
      expect(mockAuditLogger.logSignatureEvent).toHaveBeenCalled();
    });
  });
});
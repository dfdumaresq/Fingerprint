import { describe, expect, it, beforeEach, jest, afterEach } from '@jest/globals';
import { KeyManager, KeyType } from '../../src/security/KeyManager';
import { KeyProviderFactory, KeyProviderType } from '../../src/security/KeyProviderFactory';
import { MockKeyProvider } from '../mocks/MockKeyProvider';

// Mock the KeyProviderFactory
jest.mock('../../src/security/KeyProviderFactory', () => {
  // Store the original module
  const originalModule = jest.requireActual('../../src/security/KeyProviderFactory');
  
  // Create a mock MockKeyProvider instance
  const mockProvider = new MockKeyProvider();
  
  return {
    __esModule: true,
    ...originalModule,
    KeyProviderFactory: {
      getInstance: jest.fn().mockReturnValue({
        getProvider: jest.fn().mockReturnValue(mockProvider),
        updateConfig: jest.fn()
      })
    }
  };
});

describe('KeyManager', () => {
  let keyManager: KeyManager;
  let mockFactory: jest.Mocked<typeof KeyProviderFactory>;
  let mockProvider: MockKeyProvider;
  
  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Get instance of KeyManager
    keyManager = KeyManager.getInstance();
    
    // Get reference to the mocked factory
    mockFactory = KeyProviderFactory as unknown as jest.Mocked<typeof KeyProviderFactory>;
    
    // Get reference to the mock provider
    mockProvider = mockFactory.getInstance().getProvider() as unknown as MockKeyProvider;
    mockProvider.clear();
  });
  
  afterEach(() => {
    // Reset KeyManager singleton for clean tests
    // This requires accessing a private field, using any to bypass TS checks
    (KeyManager as any).instance = undefined;
  });
  
  describe('Singleton Pattern', () => {
    it('should return the same instance when getInstance is called multiple times', () => {
      const instance1 = KeyManager.getInstance();
      const instance2 = KeyManager.getInstance();
      
      expect(instance1).toBe(instance2);
    });
  });
  
  describe('Initialization', () => {
    it('should initialize with default providers for each key type', () => {
      // Call initialize
      keyManager.initialize('test-password');
      
      // Check that updateConfig was called
      expect(mockFactory.getInstance().updateConfig).toHaveBeenCalledWith({
        masterKeyPassword: 'test-password',
        encryptedFileOptions: {
          keyDirectory: undefined
        }
      });
    });
    
    it('should configure for production when environment is production', () => {
      // Call initialize with production environment
      keyManager.initialize('test-password', 'production');
      
      // Check that updateConfig was called with vault options
      expect(mockFactory.getInstance().updateConfig).toHaveBeenCalledWith({
        vaultOptions: {
          vaultUrl: '',
          authToken: undefined,
          keyPrefix: 'fingerprint/'
        }
      });
    });
  });
  
  describe('Key Operations', () => {
    beforeEach(async () => {
      // Pre-populate with some test keys
      await mockProvider.storeKey('wallet-key-value', { 
        keyId: 'default_wallet_key',
        tags: { keyType: KeyType.WALLET.toString() }
      });
      
      await mockProvider.storeKey('signing-key-value', { 
        keyId: 'default_signing_key',
        tags: { keyType: KeyType.SIGNING.toString() }
      });
    });
    
    it('should get key with default key ID', async () => {
      // Should use default key ID when not provided
      const walletKey = await keyManager.getKey(KeyType.WALLET);
      expect(walletKey).toBe('wallet-key-value');
      
      // Should use provided key ID when specified
      const signingKey = await keyManager.getKey(KeyType.SIGNING, 'default_signing_key');
      expect(signingKey).toBe('signing-key-value');
    });
    
    it('should store key with specified type', async () => {
      // Store a new API key
      const keyId = await keyManager.storeKey(KeyType.API, 'api-key-value', {
        keyId: 'test_api_key',
        tags: {
          purpose: 'testing'
        }
      });
      
      expect(keyId).toBe('test_api_key');
      
      // Should be retrievable
      const apiKey = await keyManager.getKey(KeyType.API, 'test_api_key');
      expect(apiKey).toBe('api-key-value');
    });
    
    it('should list keys of specified type', async () => {
      // Add another wallet key
      await mockProvider.storeKey('another-wallet-key', { 
        keyId: 'another_wallet_key',
        tags: { keyType: KeyType.WALLET.toString() }
      });
      
      // List wallet keys
      const walletKeys = await keyManager.listKeys(KeyType.WALLET);
      
      expect(walletKeys.length).toBe(2);
      expect(walletKeys.map(k => k.keyId).sort()).toEqual(['another_wallet_key', 'default_wallet_key']);
      
      // List signing keys
      const signingKeys = await keyManager.listKeys(KeyType.SIGNING);
      
      expect(signingKeys.length).toBe(1);
      expect(signingKeys[0].keyId).toBe('default_signing_key');
    });
    
    it('should delete key of specified type', async () => {
      // Delete wallet key
      const deleted = await keyManager.deleteKey(KeyType.WALLET, 'default_wallet_key');
      expect(deleted).toBe(true);
      
      // Key should no longer exist
      const keys = await keyManager.listKeys(KeyType.WALLET);
      expect(keys.length).toBe(0);
    });
    
    it('should rotate key of specified type', async () => {
      // Rotate signing key
      const newKeyId = await keyManager.rotateKey(KeyType.SIGNING, 'default_signing_key');
      
      expect(newKeyId).not.toBe('default_signing_key');
      
      // Both keys should be retrievable
      const oldKey = await mockProvider.getKey('default_signing_key');
      const newKey = await mockProvider.getKey(newKeyId);
      
      expect(oldKey).toBe(newKey);
      
      // Check metadata
      const oldMetadata = await mockProvider.getKeyMetadata('default_signing_key');
      expect(oldMetadata.tags?.rotated).toBe('true');
      expect(oldMetadata.tags?.newKeyId).toBe(newKeyId);
    });
    
    it('should get key metadata', async () => {
      // Get metadata for a key
      const metadata = await keyManager.getKeyMetadata(KeyType.WALLET, 'default_wallet_key');
      
      expect(metadata.keyId).toBe('default_wallet_key');
      expect(metadata.tags?.keyType).toBe(KeyType.WALLET.toString());
    });
  });
  
  describe('Provider Configuration', () => {
    it('should set provider for key type', () => {
      // Set provider for wallet keys
      keyManager.setProviderForKeyType(KeyType.WALLET, KeyProviderType.VAULT);
      
      // Get a wallet key
      keyManager.getKey(KeyType.WALLET);
      
      // Check that factory was called with correct provider type
      expect(mockFactory.getInstance().getProvider).toHaveBeenCalledWith(KeyProviderType.VAULT);
    });
  });
});
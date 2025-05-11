import { describe, expect, it, beforeEach, jest, afterEach } from '@jest/globals';
import { KeyProviderFactory, KeyProviderType } from '../../src/security/KeyProviderFactory';
import { EnvKeyProvider } from '../../src/security/EnvKeyProvider';
import { EncryptedFileKeyProvider } from '../../src/security/EncryptedFileKeyProvider';
import { VaultKeyProvider } from '../../src/security/VaultKeyProvider';

// Mock the key provider implementations
jest.mock('../../src/security/EnvKeyProvider');
jest.mock('../../src/security/EncryptedFileKeyProvider');
jest.mock('../../src/security/VaultKeyProvider');

describe('KeyProviderFactory', () => {
  let factory: KeyProviderFactory;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Reset the factory singleton
    (KeyProviderFactory as any).instance = undefined;
    
    // Get a new instance
    factory = KeyProviderFactory.getInstance();
  });
  
  describe('Singleton Pattern', () => {
    it('should return the same instance when getInstance is called multiple times', () => {
      const instance1 = KeyProviderFactory.getInstance();
      const instance2 = KeyProviderFactory.getInstance();
      
      expect(instance1).toBe(instance2);
    });
  });
  
  describe('Provider Creation', () => {
    it('should create EnvKeyProvider by default', () => {
      const provider = factory.getProvider();
      
      expect(provider).toBeInstanceOf(EnvKeyProvider);
      expect(EnvKeyProvider).toHaveBeenCalled();
    });
    
    it('should create EncryptedFileKeyProvider when requested', () => {
      const provider = factory.getProvider(KeyProviderType.ENCRYPTED_FILE);
      
      expect(provider).toBeInstanceOf(EncryptedFileKeyProvider);
      expect(EncryptedFileKeyProvider).toHaveBeenCalled();
    });
    
    it('should create VaultKeyProvider when requested', () => {
      const provider = factory.getProvider(KeyProviderType.VAULT);
      
      expect(provider).toBeInstanceOf(VaultKeyProvider);
      expect(VaultKeyProvider).toHaveBeenCalled();
    });
    
    it('should reuse provider instances', () => {
      // Get provider twice
      const provider1 = factory.getProvider(KeyProviderType.ENV);
      const provider2 = factory.getProvider(KeyProviderType.ENV);
      
      // Should be the same instance
      expect(provider1).toBe(provider2);
      
      // EnvKeyProvider constructor should be called only once
      expect(EnvKeyProvider).toHaveBeenCalledTimes(1);
    });
  });
  
  describe('Configuration', () => {
    it('should update configuration and pass to providers', () => {
      // Update configuration
      factory.updateConfig({
        masterKeyPassword: 'test-password',
        encryptedFileOptions: {
          keyDirectory: '/tmp/keys'
        },
        vaultOptions: {
          vaultUrl: 'https://vault.example.com',
          authToken: 'test-token',
          keyPrefix: 'test/'
        }
      });
      
      // Create providers
      factory.getProvider(KeyProviderType.ENCRYPTED_FILE);
      factory.getProvider(KeyProviderType.VAULT);
      
      // Check that providers were created with correct options
      expect(EncryptedFileKeyProvider).toHaveBeenCalledWith({
        keyDirectory: '/tmp/keys',
        masterPassword: 'test-password'
      });
      
      expect(VaultKeyProvider).toHaveBeenCalledWith({
        vaultUrl: 'https://vault.example.com',
        authToken: 'test-token',
        keyPrefix: 'test/'
      });
    });
    
    it('should set default provider type', () => {
      // Set default provider type
      factory.setDefaultProviderType(KeyProviderType.VAULT);
      
      // Get default provider
      const provider = factory.getProvider();
      
      // Should be VaultKeyProvider
      expect(provider).toBeInstanceOf(VaultKeyProvider);
    });
  });
});
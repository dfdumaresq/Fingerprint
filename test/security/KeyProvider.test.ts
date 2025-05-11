import { describe, expect, it, beforeEach } from '@jest/globals';
import { MockKeyProvider } from '../mocks/MockKeyProvider';
import { EnvKeyProvider } from '../../src/security/EnvKeyProvider';
import { KeyMetadata } from '../../src/security/KeyProvider';

describe('KeyProvider Interface', () => {
  // We'll use the MockKeyProvider to test the interface
  let mockProvider: MockKeyProvider;

  beforeEach(() => {
    mockProvider = new MockKeyProvider();
    mockProvider.clear(); // Clear any existing keys
    
    // Set environment variables for EnvKeyProvider tests
    process.env.TEST_KEY_1 = 'test-key-value-1';
    process.env.TEST_KEY_2 = 'test-key-value-2';
  });

  describe('MockKeyProvider Implementation', () => {
    it('should store and retrieve keys', async () => {
      // Store a key
      const keyId = await mockProvider.storeKey('testKeyValue', {
        keyId: 'test-key-1',
        tags: {
          purpose: 'testing',
          environment: 'test'
        }
      });

      expect(keyId).toBe('test-key-1');

      // Retrieve the key
      const retrievedKey = await mockProvider.getKey('test-key-1');
      expect(retrievedKey).toBe('testKeyValue');
    });

    it('should track access metadata', async () => {
      // Store a key
      await mockProvider.storeKey('testKeyValue', {
        keyId: 'test-key-2'
      });

      // Access it multiple times
      await mockProvider.getKey('test-key-2');
      await mockProvider.getKey('test-key-2');
      await mockProvider.getKey('test-key-2');

      // Get the metadata
      const metadata = await mockProvider.getKeyMetadata('test-key-2');
      expect(metadata.accessCount).toBe(3);
      expect(metadata.lastAccessed).toBeInstanceOf(Date);
    });

    it('should list all keys', async () => {
      // Store multiple keys
      await mockProvider.storeKey('testKeyValue1', { keyId: 'test-key-3' });
      await mockProvider.storeKey('testKeyValue2', { keyId: 'test-key-4' });
      await mockProvider.storeKey('testKeyValue3', { keyId: 'test-key-5' });

      // List keys
      const keys = await mockProvider.listKeys();
      expect(keys.length).toBe(3);
      expect(keys.map(k => k.keyId).sort()).toEqual(['test-key-3', 'test-key-4', 'test-key-5']);
    });

    it('should delete keys', async () => {
      // Store a key
      await mockProvider.storeKey('testKeyValue', { keyId: 'test-key-6' });

      // Confirm it exists
      const exists = await mockProvider.getKey('test-key-6').then(() => true).catch(() => false);
      expect(exists).toBe(true);

      // Delete it
      const deleted = await mockProvider.deleteKey('test-key-6');
      expect(deleted).toBe(true);

      // Confirm it no longer exists
      const stillExists = await mockProvider.getKey('test-key-6').then(() => true).catch(() => false);
      expect(stillExists).toBe(false);

      // Try to delete a non-existent key
      const nonExistentDeleted = await mockProvider.deleteKey('non-existent-key');
      expect(nonExistentDeleted).toBe(false);
    });

    it('should rotate keys', async () => {
      // Store a key
      await mockProvider.storeKey('rotatingKeyValue', {
        keyId: 'rotating-key',
        tags: {
          purpose: 'rotation-test'
        }
      });

      // Rotate the key
      const newKeyId = await mockProvider.rotateKey('rotating-key');
      expect(newKeyId).not.toBe('rotating-key');
      expect(newKeyId).toContain('rotating-key-rotated-');

      // Check the original key's metadata
      const originalMetadata = await mockProvider.getKeyMetadata('rotating-key');
      expect(originalMetadata.tags?.rotated).toBe('true');
      expect(originalMetadata.tags?.newKeyId).toBe(newKeyId);

      // Check the new key's metadata
      const newMetadata = await mockProvider.getKeyMetadata(newKeyId);
      expect(newMetadata.tags?.previousKeyId).toBe('rotating-key');

      // Both keys should have the same value
      const originalValue = await mockProvider.getKey('rotating-key');
      const newValue = await mockProvider.getKey(newKeyId);
      expect(originalValue).toBe(newValue);
    });

    it('should enforce key expiration', async () => {
      // Store a key that's already expired
      const expiredDate = new Date();
      expiredDate.setDate(expiredDate.getDate() - 1); // 1 day in the past
      
      await mockProvider.storeKey('expiredKeyValue', {
        keyId: 'expired-key',
        expiresAt: expiredDate
      });

      // Try to access the expired key
      await expect(mockProvider.getKey('expired-key')).rejects.toThrow('expired');

      // Store a key that's not expired
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1); // 1 day in the future
      
      await mockProvider.storeKey('validKeyValue', {
        keyId: 'valid-key',
        expiresAt: futureDate
      });

      // Should be able to access the valid key
      const validKey = await mockProvider.getKey('valid-key');
      expect(validKey).toBe('validKeyValue');
    });

    it('should log access operations', async () => {
      // Store a key
      await mockProvider.storeKey('auditedKeyValue', { keyId: 'audited-key' });

      // Perform various operations
      await mockProvider.getKey('audited-key');
      await mockProvider.rotateKey('audited-key');
      await mockProvider.deleteKey('audited-key');

      // Check access logs
      const logs = mockProvider.getAccessLogs();
      expect(logs.length).toBe(4); // store, get, rotate, delete

      expect(logs[0].operation).toBe('store');
      expect(logs[1].operation).toBe('get');
      expect(logs[2].operation).toBe('rotate');
      expect(logs[3].operation).toBe('delete');

      logs.forEach(log => {
        expect(log.keyId).toBe('audited-key');
        expect(log.timestamp).toBeInstanceOf(Date);
      });
    });
  });

  describe('EnvKeyProvider Implementation', () => {
    let envProvider: EnvKeyProvider;

    beforeEach(() => {
      envProvider = new EnvKeyProvider();
    });

    it('should retrieve keys from environment variables', async () => {
      // Get key from environment variable
      const key1 = await envProvider.getKey('TEST_KEY_1');
      expect(key1).toBe('test-key-value-1');

      const key2 = await envProvider.getKey('TEST_KEY_2');
      expect(key2).toBe('test-key-value-2');
    });

    it('should fail when environment variable does not exist', async () => {
      await expect(envProvider.getKey('NON_EXISTENT_KEY')).rejects.toThrow('not found');
    });

    it('should list keys with metadata', async () => {
      const keys = await envProvider.listKeys();
      
      // Should include our test keys
      const testKey1 = keys.find(k => k.keyId === 'TEST_KEY_1');
      const testKey2 = keys.find(k => k.keyId === 'TEST_KEY_2');
      
      expect(testKey1).toBeDefined();
      expect(testKey2).toBeDefined();
      
      // EnvKeyProvider keys don't expire by default
      expect(testKey1?.expiresAt).toBeUndefined();
      expect(testKey2?.expiresAt).toBeUndefined();
    });

    it('should store key as environment variable', async () => {
      const keyId = await envProvider.storeKey('new-env-key-value', {
        keyId: 'TEST_NEW_KEY'
      });
      
      expect(keyId).toBe('TEST_NEW_KEY');
      expect(process.env.TEST_NEW_KEY).toBe('new-env-key-value');
      
      // Should be able to retrieve it
      const retrievedKey = await envProvider.getKey('TEST_NEW_KEY');
      expect(retrievedKey).toBe('new-env-key-value');
    });
  });
});
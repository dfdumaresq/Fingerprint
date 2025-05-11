import { KeyProvider, KeyMetadata, KeyProviderOptions } from './KeyProvider';
import * as crypto from 'crypto';

/**
 * Environment variable based key provider
 * 
 * NOTE: This provider is intended for development use only and
 * does not provide secure key storage. For production, use
 * a more secure provider like EncryptedFileKeyProvider or VaultKeyProvider
 */
export class EnvKeyProvider implements KeyProvider {
  private options: KeyProviderOptions;
  private keyMap = new Map<string, string>();
  private metadataMap = new Map<string, KeyMetadata>();
  private keyPrefix: string;
  
  /**
   * Create a new environment variable key provider
   * @param options Provider options
   * @param keyPrefix Prefix for environment variables storing keys (default: 'KEY_')
   */
  constructor(options: KeyProviderOptions = {}, keyPrefix = 'KEY_') {
    this.options = {
      autoRotate: false,
      enforceExpiration: true,
      auditAccess: true,
      ...options
    };
    this.keyPrefix = keyPrefix;
    this.loadKeysFromEnv();
  }
  
  /**
   * Load keys from environment variables
   * @private
   */
  private loadKeysFromEnv() {
    // Find all environment variables with the key prefix
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith(this.keyPrefix) && value) {
        const keyId = key.substring(this.keyPrefix.length);
        this.keyMap.set(keyId, value);
        
        // Create metadata for the key if it doesn't exist
        if (!this.metadataMap.has(keyId)) {
          this.metadataMap.set(keyId, {
            keyId,
            createdAt: new Date(),
            accessCount: 0
          });
        }
      }
    }
    
    console.log(`Loaded ${this.keyMap.size} keys from environment variables`);
  }
  
  /**
   * Get a key by ID
   * @param keyId The key ID to retrieve
   * @returns The key as a string
   */
  async getKey(keyId: string): Promise<string> {
    // Check if the key exists
    if (!this.keyMap.has(keyId)) {
      // Try to load from environment variable directly
      const envKey = process.env[`${this.keyPrefix}${keyId}`];
      if (!envKey) {
        throw new Error(`Key not found: ${keyId}`);
      }
      
      this.keyMap.set(keyId, envKey);
      
      // Create metadata for the key if it doesn't exist
      if (!this.metadataMap.has(keyId)) {
        this.metadataMap.set(keyId, {
          keyId,
          createdAt: new Date(),
          accessCount: 0
        });
      }
    }
    
    // Get the metadata
    const metadata = await this.getKeyMetadata(keyId);
    
    // Check if the key is expired
    if (this.options.enforceExpiration && metadata.expiresAt && metadata.expiresAt < new Date()) {
      throw new Error(`Key expired: ${keyId}`);
    }
    
    // Check if the key needs rotation
    if (this.options.autoRotate && metadata.rotationDue && metadata.rotationDue < new Date()) {
      await this.rotateKey(keyId);
      console.warn(`Key ${keyId} auto-rotated due to rotation policy`);
    }
    
    // Update access information if auditing is enabled
    if (this.options.auditAccess) {
      metadata.lastAccessed = new Date();
      metadata.accessCount = (metadata.accessCount || 0) + 1;
      this.metadataMap.set(keyId, metadata);
    }
    
    return this.keyMap.get(keyId)!;
  }
  
  /**
   * Store a new key in environment variables
   * @param key The key to store
   * @param metadata Optional metadata about the key
   * @returns The ID of the stored key
   */
  async storeKey(key: string, metadata?: Partial<KeyMetadata>): Promise<string> {
    // Generate a key ID if not provided
    const keyId = metadata?.keyId || crypto.randomUUID();
    
    // Store the key in the environment variable
    process.env[`${this.keyPrefix}${keyId}`] = key;
    this.keyMap.set(keyId, key);
    
    // Store the metadata
    const fullMetadata: KeyMetadata = {
      keyId,
      createdAt: new Date(),
      ...metadata
    };
    
    this.metadataMap.set(keyId, fullMetadata);
    
    return keyId;
  }
  
  /**
   * List all available keys
   * @returns Array of key metadata
   */
  async listKeys(): Promise<KeyMetadata[]> {
    return Array.from(this.metadataMap.values());
  }
  
  /**
   * Delete a key
   * @param keyId The ID of the key to delete
   * @returns True if the key was deleted
   */
  async deleteKey(keyId: string): Promise<boolean> {
    // Remove from maps
    const hadKey = this.keyMap.delete(keyId);
    this.metadataMap.delete(keyId);
    
    // Remove from environment
    if (process.env[`${this.keyPrefix}${keyId}`]) {
      delete process.env[`${this.keyPrefix}${keyId}`];
      return true;
    }
    
    return hadKey;
  }
  
  /**
   * Rotate a key - generate a new key and update references
   * @param keyId The ID of the key to rotate
   * @returns The ID of the new key
   */
  async rotateKey(keyId: string): Promise<string> {
    // Get the existing key
    const existingKey = await this.getKey(keyId);
    const existingMeta = await this.getKeyMetadata(keyId);
    
    // Generate a new key
    // In a real implementation, this would involve securely generating a new key
    // For this example, we'll just append a rotation indicator to the existing key
    const rotationCount = (existingMeta.tags?.rotationCount ? 
      parseInt(existingMeta.tags.rotationCount) : 0) + 1;
    
    // Store the new key with updated metadata
    const newKeyId = await this.storeKey(
      existingKey,
      {
        ...existingMeta,
        createdAt: new Date(),
        tags: {
          ...existingMeta.tags,
          rotationCount: rotationCount.toString(),
          previousKeyId: keyId
        }
      }
    );
    
    // Mark the old key as rotated
    this.metadataMap.set(keyId, {
      ...existingMeta,
      tags: {
        ...existingMeta.tags,
        rotated: 'true',
        rotatedAt: new Date().toISOString(),
        rotatedTo: newKeyId
      }
    });
    
    return newKeyId;
  }
  
  /**
   * Get metadata for a key
   * @param keyId The ID of the key
   * @returns Key metadata
   */
  async getKeyMetadata(keyId: string): Promise<KeyMetadata> {
    if (!this.metadataMap.has(keyId)) {
      // Try to see if the key exists in the environment
      const envKey = process.env[`${this.keyPrefix}${keyId}`];
      if (!envKey) {
        throw new Error(`Key not found: ${keyId}`);
      }
      
      // Create metadata for the key
      this.metadataMap.set(keyId, {
        keyId,
        createdAt: new Date()
      });
    }
    
    return this.metadataMap.get(keyId)!;
  }
}
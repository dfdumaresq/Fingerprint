import { KeyProvider, KeyMetadata, KeyProviderOptions } from './KeyProvider';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Options specific to the encrypted file key provider
 */
export interface EncryptedFileKeyProviderOptions extends KeyProviderOptions {
  /**
   * Directory to store keys in
   */
  keyDirectory: string;
  
  /**
   * Encryption key to use for protecting stored keys
   * In a production environment, this should be securely stored
   * in a hardware security module or secure key vault
   */
  masterKey: string | Buffer;
  
  /**
   * Algorithm to use for encryption
   * @default 'aes-256-gcm'
   */
  algorithm?: string;
}

/**
 * Structure of a stored encrypted key
 */
interface StoredEncryptedKey {
  /**
   * The encrypted key content
   */
  encryptedData: string;
  
  /**
   * The initialization vector used for encryption
   */
  iv: string;
  
  /**
   * The authentication tag for AEAD algorithms
   */
  authTag?: string;
  
  /**
   * Metadata about the key
   */
  metadata: KeyMetadata;
}

/**
 * Encrypted file-based key provider
 * 
 * Securely stores keys in encrypted files using AES-GCM encryption.
 * This provides better security than the environment variable provider
 * and is suitable for development and test environments.
 * 
 * For production, consider using a hardware security module (HSM)
 * or a managed key vault service.
 */
export class EncryptedFileKeyProvider implements KeyProvider {
  private options: EncryptedFileKeyProviderOptions;
  private metadataCache = new Map<string, KeyMetadata>();
  
  /**
   * Create a new encrypted file key provider
   * @param options Provider options
   */
  constructor(options: EncryptedFileKeyProviderOptions) {
    this.options = {
      autoRotate: false,
      enforceExpiration: true,
      auditAccess: true,
      algorithm: 'aes-256-gcm',
      ...options
    };
  }
  
  /**
   * Ensure the key directory exists
   * @private
   */
  private async ensureKeyDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.options.keyDirectory, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create key directory: ${error}`);
    }
  }
  
  /**
   * Get the path to a key file
   * @param keyId The key ID
   * @returns Path to the key file
   * @private
   */
  private getKeyPath(keyId: string): string {
    return path.join(this.options.keyDirectory, `${keyId}.key`);
  }
  
  /**
   * Encrypt data using the master key
   * @param data Data to encrypt
   * @returns Encrypted data, IV, and auth tag
   * @private
   */
  private encrypt(data: string): { encryptedData: string, iv: string, authTag?: string } {
    // Convert the master key to a Buffer if it's a string
    const masterKey = Buffer.isBuffer(this.options.masterKey) 
      ? this.options.masterKey 
      : Buffer.from(this.options.masterKey);
    
    // Generate a random IV
    const iv = crypto.randomBytes(16);
    
    // Create a cipher
    const cipher = crypto.createCipheriv(
      this.options.algorithm!, 
      masterKey, 
      iv
    ) as crypto.CipherGCM;
    
    // Encrypt the data
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Get the auth tag for GCM mode
    const authTag = 'getAuthTag' in cipher ? cipher.getAuthTag().toString('hex') : undefined;
    
    return {
      encryptedData: encrypted,
      iv: iv.toString('hex'),
      authTag
    };
  }
  
  /**
   * Decrypt data using the master key
   * @param encryptedData Encrypted data
   * @param iv Initialization vector
   * @param authTag Authentication tag (for GCM mode)
   * @returns Decrypted data
   * @private
   */
  private decrypt(encryptedData: string, iv: string, authTag?: string): string {
    // Convert the master key to a Buffer if it's a string
    const masterKey = Buffer.isBuffer(this.options.masterKey) 
      ? this.options.masterKey 
      : Buffer.from(this.options.masterKey);
    
    // Create a decipher
    const decipher = crypto.createDecipheriv(
      this.options.algorithm!, 
      masterKey, 
      Buffer.from(iv, 'hex')
    ) as crypto.DecipherGCM;
    
    // Set the auth tag for GCM mode
    if (authTag && 'setAuthTag' in decipher) {
      decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    }
    
    // Decrypt the data
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
  
  /**
   * Get a key by ID
   * @param keyId The key ID to retrieve
   * @returns The key as a string
   */
  async getKey(keyId: string): Promise<string> {
    const keyPath = this.getKeyPath(keyId);
    
    try {
      // Read the key file
      const keyFile = await fs.readFile(keyPath, 'utf8');
      const storedKey: StoredEncryptedKey = JSON.parse(keyFile);
      
      // Check if the key is expired
      if (
        this.options.enforceExpiration && 
        storedKey.metadata.expiresAt && 
        new Date(storedKey.metadata.expiresAt) < new Date()
      ) {
        throw new Error(`Key expired: ${keyId}`);
      }
      
      // Check if the key needs rotation
      if (
        this.options.autoRotate && 
        storedKey.metadata.rotationDue && 
        new Date(storedKey.metadata.rotationDue) < new Date()
      ) {
        await this.rotateKey(keyId);
        console.warn(`Key ${keyId} auto-rotated due to rotation policy`);
        
        // Re-read the rotated key
        return this.getKey(keyId);
      }
      
      // Update access information if auditing is enabled
      if (this.options.auditAccess) {
        storedKey.metadata.lastAccessed = new Date();
        storedKey.metadata.accessCount = (storedKey.metadata.accessCount || 0) + 1;
        
        // Update the metadata cache
        this.metadataCache.set(keyId, storedKey.metadata);
        
        // Write the updated metadata back to the file
        await fs.writeFile(keyPath, JSON.stringify(storedKey, null, 2));
      }
      
      // Decrypt and return the key
      return this.decrypt(
        storedKey.encryptedData, 
        storedKey.iv, 
        storedKey.authTag
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Key not found: ${keyId}`);
      }
      throw error;
    }
  }
  
  /**
   * Store a new key
   * @param key The key to store
   * @param metadata Optional metadata about the key
   * @returns The ID of the stored key
   */
  async storeKey(key: string, metadata?: Partial<KeyMetadata>): Promise<string> {
    await this.ensureKeyDirectory();
    
    // Generate a key ID if not provided
    const keyId = metadata?.keyId || crypto.randomUUID();
    const keyPath = this.getKeyPath(keyId);
    
    // Create full metadata
    const fullMetadata: KeyMetadata = {
      keyId,
      createdAt: new Date(),
      ...metadata
    };
    
    // Encrypt the key
    const { encryptedData, iv, authTag } = this.encrypt(key);
    
    // Store the encrypted key and metadata
    const storedKey: StoredEncryptedKey = {
      encryptedData,
      iv,
      authTag,
      metadata: fullMetadata
    };
    
    // Write to the file
    await fs.writeFile(keyPath, JSON.stringify(storedKey, null, 2));
    
    // Update the metadata cache
    this.metadataCache.set(keyId, fullMetadata);
    
    return keyId;
  }
  
  /**
   * List all available keys
   * @returns Array of key metadata
   */
  async listKeys(): Promise<KeyMetadata[]> {
    await this.ensureKeyDirectory();
    
    try {
      // Read the key directory
      const files = await fs.readdir(this.options.keyDirectory);
      
      // Filter for key files
      const keyFiles = files.filter(file => file.endsWith('.key'));
      
      // Read the metadata from each key file
      const metadataPromises = keyFiles.map(async file => {
        const keyId = path.basename(file, '.key');
        
        // Check if we have the metadata in the cache
        if (this.metadataCache.has(keyId)) {
          return this.metadataCache.get(keyId)!;
        }
        
        // Read the key file to get the metadata
        try {
          const keyFile = await fs.readFile(path.join(this.options.keyDirectory, file), 'utf8');
          const storedKey: StoredEncryptedKey = JSON.parse(keyFile);
          
          // Update the cache
          this.metadataCache.set(keyId, storedKey.metadata);
          
          return storedKey.metadata;
        } catch (error) {
          console.error(`Failed to read key file ${file}: ${error}`);
          return null;
        }
      });
      
      // Wait for all metadata to be read
      const allMetadata = await Promise.all(metadataPromises);
      
      // Filter out null values and return
      return allMetadata.filter(metadata => metadata !== null) as KeyMetadata[];
    } catch (error) {
      console.error(`Failed to list keys: ${error}`);
      return [];
    }
  }
  
  /**
   * Delete a key
   * @param keyId The ID of the key to delete
   * @returns True if the key was deleted
   */
  async deleteKey(keyId: string): Promise<boolean> {
    const keyPath = this.getKeyPath(keyId);
    
    try {
      await fs.unlink(keyPath);
      this.metadataCache.delete(keyId);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }
  
  /**
   * Rotate a key - generate a new key and update references
   * @param keyId The ID of the key to rotate
   * @returns The ID of the new key
   */
  async rotateKey(keyId: string): Promise<string> {
    // Get the existing key and metadata
    const existingKey = await this.getKey(keyId);
    const existingMeta = await this.getKeyMetadata(keyId);
    
    // Determine the rotation count
    const rotationCount = (existingMeta.tags?.rotationCount ? 
      parseInt(existingMeta.tags.rotationCount) : 0) + 1;
    
    // Generate a new key ID
    const newKeyId = `${keyId}-${rotationCount}`;
    
    // Store the new key with updated metadata
    await this.storeKey(
      existingKey,
      {
        keyId: newKeyId,
        createdAt: new Date(),
        tags: {
          ...existingMeta.tags,
          rotationCount: rotationCount.toString(),
          previousKeyId: keyId
        }
      }
    );
    
    // Update the old key's metadata to indicate it has been rotated
    const oldMetadata = await this.getKeyMetadata(keyId);
    await this.updateKeyMetadata(keyId, {
      ...oldMetadata,
      tags: {
        ...oldMetadata.tags,
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
    // Check if we have the metadata in the cache
    if (this.metadataCache.has(keyId)) {
      return this.metadataCache.get(keyId)!;
    }
    
    const keyPath = this.getKeyPath(keyId);
    
    try {
      // Read the key file
      const keyFile = await fs.readFile(keyPath, 'utf8');
      const storedKey: StoredEncryptedKey = JSON.parse(keyFile);
      
      // Update the cache
      this.metadataCache.set(keyId, storedKey.metadata);
      
      return storedKey.metadata;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Key not found: ${keyId}`);
      }
      throw error;
    }
  }
  
  /**
   * Update metadata for a key
   * @param keyId The ID of the key
   * @param metadata The new metadata
   * @private
   */
  private async updateKeyMetadata(keyId: string, metadata: KeyMetadata): Promise<void> {
    const keyPath = this.getKeyPath(keyId);
    
    try {
      // Read the key file
      const keyFile = await fs.readFile(keyPath, 'utf8');
      const storedKey: StoredEncryptedKey = JSON.parse(keyFile);
      
      // Update the metadata
      storedKey.metadata = metadata;
      
      // Write the updated key file
      await fs.writeFile(keyPath, JSON.stringify(storedKey, null, 2));
      
      // Update the cache
      this.metadataCache.set(keyId, metadata);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Key not found: ${keyId}`);
      }
      throw error;
    }
  }
}

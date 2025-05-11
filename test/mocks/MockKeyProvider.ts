import { KeyProvider, KeyMetadata, KeyProviderOptions } from '../../src/security/KeyProvider';

/**
 * Mock implementation of KeyProvider for testing
 */
export class MockKeyProvider implements KeyProvider {
  private keys: Map<string, string> = new Map();
  private metadata: Map<string, KeyMetadata> = new Map();
  private options: KeyProviderOptions;
  private accessLogs: Array<{ keyId: string, operation: string, timestamp: Date }> = [];

  constructor(options: KeyProviderOptions = {}) {
    this.options = {
      autoRotate: false,
      enforceExpiration: true,
      auditAccess: true,
      ...options
    };
  }

  /**
   * Get a key by ID
   * @param keyId Key identifier
   * @returns The key value
   */
  public async getKey(keyId: string): Promise<string> {
    this.logAccess(keyId, 'get');
    
    // Check if key exists
    if (!this.keys.has(keyId)) {
      throw new Error(`Key ${keyId} not found`);
    }
    
    // Check if key is expired
    const metadata = this.metadata.get(keyId);
    if (this.options.enforceExpiration && metadata?.expiresAt && metadata.expiresAt < new Date()) {
      throw new Error(`Key ${keyId} has expired`);
    }
    
    // Update last accessed timestamp and count
    if (metadata) {
      metadata.lastAccessed = new Date();
      metadata.accessCount = (metadata.accessCount || 0) + 1;
      this.metadata.set(keyId, metadata);
    }
    
    return this.keys.get(keyId) as string;
  }

  /**
   * Store a new key
   * @param key Key value to store
   * @param metadata Optional metadata for the key
   * @returns Generated or provided key ID
   */
  public async storeKey(key: string, metadata: Partial<KeyMetadata> = {}): Promise<string> {
    const keyId = metadata.keyId || `key-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    this.logAccess(keyId, 'store');
    
    // Create and store full metadata
    const fullMetadata: KeyMetadata = {
      keyId,
      createdAt: new Date(),
      ...metadata
    };
    
    this.keys.set(keyId, key);
    this.metadata.set(keyId, fullMetadata);
    
    return keyId;
  }

  /**
   * List all keys
   * @returns Array of key metadata
   */
  public async listKeys(): Promise<KeyMetadata[]> {
    return Array.from(this.metadata.values());
  }

  /**
   * Delete a key
   * @param keyId Key identifier
   * @returns True if key was deleted
   */
  public async deleteKey(keyId: string): Promise<boolean> {
    this.logAccess(keyId, 'delete');
    
    if (!this.keys.has(keyId)) {
      return false;
    }
    
    this.keys.delete(keyId);
    this.metadata.delete(keyId);
    
    return true;
  }

  /**
   * Rotate a key
   * @param keyId Key identifier
   * @returns New key ID
   */
  public async rotateKey(keyId: string): Promise<string> {
    this.logAccess(keyId, 'rotate');
    
    // Get the existing key and metadata
    if (!this.keys.has(keyId)) {
      throw new Error(`Key ${keyId} not found`);
    }
    
    const oldKey = this.keys.get(keyId) as string;
    const oldMetadata = this.metadata.get(keyId);
    
    if (!oldMetadata) {
      throw new Error(`Metadata for key ${keyId} not found`);
    }
    
    // Generate a new key ID with a rotation suffix
    const newKeyId = `${keyId}-rotated-${Date.now()}`;
    
    // Create new metadata with reference to previous key
    const newMetadata: KeyMetadata = {
      ...oldMetadata,
      keyId: newKeyId,
      createdAt: new Date(),
      rotationDue: undefined, // Reset rotation due date
      tags: {
        ...oldMetadata.tags,
        previousKeyId: keyId,
        rotatedAt: new Date().toISOString()
      }
    };
    
    // Store the new key
    this.keys.set(newKeyId, oldKey); // For testing, we're not actually changing the key value
    this.metadata.set(newKeyId, newMetadata);
    
    // Mark the old key as rotated in its metadata but keep it for reference
    oldMetadata.tags = {
      ...oldMetadata.tags,
      rotated: 'true',
      rotatedAt: new Date().toISOString(),
      newKeyId
    };
    
    this.metadata.set(keyId, oldMetadata);
    
    return newKeyId;
  }

  /**
   * Get metadata for a key
   * @param keyId Key identifier
   * @returns Key metadata
   */
  public async getKeyMetadata(keyId: string): Promise<KeyMetadata> {
    if (!this.metadata.has(keyId)) {
      throw new Error(`Metadata for key ${keyId} not found`);
    }
    
    return this.metadata.get(keyId) as KeyMetadata;
  }

  /**
   * Log key access for auditing
   * @param keyId Key identifier
   * @param operation Operation being performed
   * @private
   */
  private logAccess(keyId: string, operation: string): void {
    if (this.options.auditAccess) {
      this.accessLogs.push({
        keyId,
        operation,
        timestamp: new Date()
      });
    }
  }

  /**
   * Get access logs for testing
   * @returns Array of access logs
   */
  public getAccessLogs(): Array<{ keyId: string, operation: string, timestamp: Date }> {
    return this.accessLogs;
  }

  /**
   * Clear all keys and metadata (for testing)
   */
  public clear(): void {
    this.keys.clear();
    this.metadata.clear();
    this.accessLogs = [];
  }
}
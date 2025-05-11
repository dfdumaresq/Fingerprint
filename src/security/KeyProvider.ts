/**
 * KeyProvider Interface
 * 
 * Following OWASP Key Management Guidelines:
 * 1. Proper key isolation and access control
 * 2. Secure key storage with appropriate encryption
 * 3. Key rotation capabilities
 * 4. Auditing and monitoring of key usage
 * 5. Protection against extraction and unauthorized use
 */

export interface KeyMetadata {
  keyId: string;
  createdAt: Date;
  expiresAt?: Date;
  tags?: Record<string, string>;
  rotationDue?: Date;
  lastAccessed?: Date;
  accessCount?: number;
}

export interface KeyProviderOptions {
  /**
   * Auto-rotate keys that are due for rotation
   * @default false
   */
  autoRotate?: boolean;

  /**
   * Whether to enforce key expiration
   * @default true
   */
  enforceExpiration?: boolean;

  /**
   * Log access to keys for auditing
   * @default true
   */
  auditAccess?: boolean;
  
  /**
   * Additional provider-specific options
   */
  providerOptions?: Record<string, any>;
}

/**
 * KeyProvider interface for securely managing cryptographic keys
 * 
 * This interface follows OWASP Key Management best practices:
 * - Isolation between key storage and usage
 * - Appropriate access controls
 * - Key rotation capabilities
 * - Visibility into key lifecycle
 */
export interface KeyProvider {
  /**
   * Get a key by its ID
   * @param keyId The ID of the key to retrieve
   * @returns The key as a string (should be handled securely)
   */
  getKey(keyId: string): Promise<string>;
  
  /**
   * Store a new key
   * @param key The key to store (handle securely)
   * @param metadata Optional metadata about the key
   * @returns The ID of the stored key
   */
  storeKey(key: string, metadata?: Partial<KeyMetadata>): Promise<string>;
  
  /**
   * List available keys
   * @returns Array of key metadata
   */
  listKeys(): Promise<KeyMetadata[]>;
  
  /**
   * Delete a key by its ID
   * @param keyId The ID of the key to delete
   * @returns True if successful, false otherwise
   */
  deleteKey(keyId: string): Promise<boolean>;
  
  /**
   * Rotate a key - generate a new key and update references
   * @param keyId The ID of the key to rotate
   * @returns The ID of the new key
   */
  rotateKey(keyId: string): Promise<string>;
  
  /**
   * Get metadata about a key
   * @param keyId The ID of the key
   * @returns Key metadata
   */
  getKeyMetadata(keyId: string): Promise<KeyMetadata>;
}
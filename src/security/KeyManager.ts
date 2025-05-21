import { KeyProviderFactory, KeyProviderType } from './KeyProviderFactory';
import { KeyProvider, KeyMetadata } from './KeyProvider';

/**
 * Key types used in the application
 */
export enum KeyType {
  DEPLOYMENT = 'deployment',
  WALLET = 'wallet',
  SIGNING = 'signing',
  API = 'api'
}

/**
 * Key manager for the application
 * 
 * This is a convenient facade for accessing keys within the application
 * using the appropriate key provider for each key type.
 */
export class KeyManager {
  private static instance: KeyManager;
  private factory: KeyProviderFactory;
  private keyTypeProviders = new Map<KeyType, KeyProviderType>();
  
  /**
   * Create a new key manager
   * @private
   */
  private constructor() {
    // Initialize the factory
    this.factory = KeyProviderFactory.getInstance();
    
    // Set default providers for each key type
    this.keyTypeProviders.set(KeyType.DEPLOYMENT, KeyProviderType.ENV);
    this.keyTypeProviders.set(KeyType.WALLET, KeyProviderType.ENCRYPTED_FILE);
    this.keyTypeProviders.set(KeyType.SIGNING, KeyProviderType.ENCRYPTED_FILE);
    this.keyTypeProviders.set(KeyType.API, KeyProviderType.ENV);
  }
  
  /**
   * Get the singleton instance of the key manager
   * @returns The key manager instance
   */
  public static getInstance(): KeyManager {
    if (!KeyManager.instance) {
      KeyManager.instance = new KeyManager();
    }
    return KeyManager.instance;
  }
  
  /**
   * Initialize the key manager with configuration
   * @param masterKeyPassword Password for securing keys (if not using a vault)
   * @param environment The execution environment
   */
  public initialize(masterKeyPassword?: string, environment = 'development'): void {
    // Configure the key provider factory based on the environment
    if (environment === 'production') {
      // In production, use the vault provider for sensitive keys
      this.keyTypeProviders.set(KeyType.WALLET, KeyProviderType.VAULT);
      this.keyTypeProviders.set(KeyType.SIGNING, KeyProviderType.VAULT);
      
      // Configure the vault provider
      this.factory.updateConfig({
        vaultOptions: {
          vaultUrl: process.env.VAULT_URL || '',
          authToken: process.env.VAULT_TOKEN,
          keyPrefix: 'fingerprint/'
        }
      });
    } else {
      // In development, use encrypted file storage with the provided password
      this.factory.updateConfig({
        masterKeyPassword: process.env.MASTER_KEY_PASSWORD || '',
        encryptedFileOptions: {
          keyDirectory: process.env.KEY_DIRECTORY || './keys',
          masterKey: process.env.MASTER_KEY || '',
          algorithm: process.env.ALGORITHM || ''
        }
      });
    }
  }
  
  /**
   * Set the provider type for a key type
   * @param keyType The key type
   * @param providerType The provider type to use
   */
  public setProviderForKeyType(keyType: KeyType, providerType: KeyProviderType): void {
    this.keyTypeProviders.set(keyType, providerType);
  }
  
  /**
   * Get the provider for a key type
   * @param keyType The key type
   * @returns The key provider
   * @private
   */
  private getProviderForKeyType(keyType: KeyType): KeyProvider {
    const providerType = this.keyTypeProviders.get(keyType) || KeyProviderType.ENV;
    return this.factory.getProvider(providerType);
  }
  
  /**
   * Get a key by type and ID
   * @param keyType The type of key
   * @param keyId The ID of the key (optional - uses default key ID for the type if not provided)
   * @returns The key as a string
   */
  public async getKey(keyType: KeyType, keyId?: string): Promise<string> {
    const provider = this.getProviderForKeyType(keyType);
    const finalKeyId = keyId || this.getDefaultKeyId(keyType);
    
    return provider.getKey(finalKeyId);
  }
  
  /**
   * Store a key
   * @param keyType The type of key
   * @param key The key to store
   * @param metadata Optional metadata about the key
   * @returns The ID of the stored key
   */
  public async storeKey(
    keyType: KeyType, 
    key: string, 
    metadata?: Partial<KeyMetadata>
  ): Promise<string> {
    const provider = this.getProviderForKeyType(keyType);
    return provider.storeKey(key, metadata);
  }
  
  /**
   * List keys of a given type
   * @param keyType The type of keys to list
   * @returns Array of key metadata
   */
  public async listKeys(keyType: KeyType): Promise<KeyMetadata[]> {
    const provider = this.getProviderForKeyType(keyType);
    const allKeys = await provider.listKeys();
    
    // Filter for keys of this type
    return allKeys.filter(metadata => 
      metadata.tags?.keyType === keyType.toString() || 
      !metadata.tags?.keyType // Include keys without a type tag for backward compatibility
    );
  }
  
  /**
   * Delete a key
   * @param keyType The type of key
   * @param keyId The ID of the key
   * @returns True if the key was deleted
   */
  public async deleteKey(keyType: KeyType, keyId: string): Promise<boolean> {
    const provider = this.getProviderForKeyType(keyType);
    return provider.deleteKey(keyId);
  }
  
  /**
   * Rotate a key
   * @param keyType The type of key
   * @param keyId The ID of the key (optional - uses default key ID for the type if not provided)
   * @returns The ID of the new key
   */
  public async rotateKey(keyType: KeyType, keyId?: string): Promise<string> {
    const provider = this.getProviderForKeyType(keyType);
    const finalKeyId = keyId || this.getDefaultKeyId(keyType);
    
    return provider.rotateKey(finalKeyId);
  }
  
  /**
   * Get metadata for a key
   * @param keyType The type of key
   * @param keyId The ID of the key (optional - uses default key ID for the type if not provided)
   * @returns Key metadata
   */
  public async getKeyMetadata(keyType: KeyType, keyId?: string): Promise<KeyMetadata> {
    const provider = this.getProviderForKeyType(keyType);
    const finalKeyId = keyId || this.getDefaultKeyId(keyType);
    
    return provider.getKeyMetadata(finalKeyId);
  }
  
  /**
   * Get the default key ID for a key type
   * @param keyType The key type
   * @returns The default key ID
   * @private
   */
  private getDefaultKeyId(keyType: KeyType): string {
    // Use environment variables for default key IDs
    switch (keyType) {
      case KeyType.DEPLOYMENT:
        return process.env.DEPLOYMENT_KEY_ID || 'default_deployment_key';
      case KeyType.WALLET:
        return process.env.WALLET_KEY_ID || 'default_wallet_key';
      case KeyType.SIGNING:
        return process.env.SIGNING_KEY_ID || 'default_signing_key';
      case KeyType.API:
        return process.env.API_KEY_ID || 'default_api_key';
      default:
        throw new Error(`Unknown key type: ${keyType}`);
    }
  }
}

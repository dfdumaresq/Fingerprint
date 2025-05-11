import { KeyProvider, KeyProviderOptions } from './KeyProvider';
import { EnvKeyProvider } from './EnvKeyProvider';
import { EncryptedFileKeyProvider, EncryptedFileKeyProviderOptions } from './EncryptedFileKeyProvider';
import { VaultKeyProvider, VaultKeyProviderOptions } from './VaultKeyProvider';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Key provider types supported by the factory
 */
export enum KeyProviderType {
  ENV = 'env',
  ENCRYPTED_FILE = 'encrypted-file',
  VAULT = 'vault'
}

/**
 * Configuration for the key provider factory
 */
export interface KeyProviderFactoryConfig {
  /**
   * Default provider type to use
   * @default KeyProviderType.ENV
   */
  defaultProviderType?: KeyProviderType;
  
  /**
   * Options for environment variable key provider
   */
  envOptions?: KeyProviderOptions;
  
  /**
   * Options for encrypted file key provider
   */
  encryptedFileOptions?: EncryptedFileKeyProviderOptions;
  
  /**
   * Options for vault key provider
   */
  vaultOptions?: VaultKeyProviderOptions;
  
  /**
   * Key for securing keys in local providers
   * This will be used to derive a key from the password
   */
  masterKeyPassword?: string;
  
  /**
   * Salt for key derivation
   */
  masterKeySalt?: string | Buffer;
}

/**
 * Factory class for creating and managing key providers
 */
export class KeyProviderFactory {
  private static instance: KeyProviderFactory;
  private config: KeyProviderFactoryConfig;
  private providers = new Map<KeyProviderType, KeyProvider>();
  
  /**
   * Create a new key provider factory
   * @param config Configuration options
   * @private
   */
  private constructor(config: KeyProviderFactoryConfig = {}) {
    this.config = {
      defaultProviderType: KeyProviderType.ENV,
      ...config
    };
  }
  
  /**
   * Get the singleton instance of the factory
   * @param config Configuration options (only used for first initialization)
   * @returns The factory instance
   */
  public static getInstance(config?: KeyProviderFactoryConfig): KeyProviderFactory {
    if (!KeyProviderFactory.instance) {
      KeyProviderFactory.instance = new KeyProviderFactory(config);
    }
    return KeyProviderFactory.instance;
  }
  
  /**
   * Generate a master key from a password
   * @param password The password to derive the key from
   * @param salt The salt for key derivation
   * @returns The derived key
   * @private
   */
  private deriveKey(password: string, salt: string | Buffer): Buffer {
    const saltBuffer = Buffer.isBuffer(salt) ? salt : Buffer.from(salt);
    
    // Use PBKDF2 to derive a key from the password
    return crypto.pbkdf2Sync(
      password,
      saltBuffer,
      100000, // iterations - higher is more secure but slower
      32, // key length in bytes (256 bits)
      'sha256'
    );
  }
  
  /**
   * Initialize the encrypted file provider options
   * @param options Options provided by the user
   * @returns Complete options for the encrypted file provider
   * @private
   */
  private initEncryptedFileOptions(
    options?: Partial<EncryptedFileKeyProviderOptions>
  ): EncryptedFileKeyProviderOptions {
    // Ensure we have a key directory
    const keyDirectory = options?.keyDirectory || path.join(os.homedir(), '.fingerprint', 'keys');
    
    // Create the directory if it doesn't exist
    if (!fs.existsSync(keyDirectory)) {
      fs.mkdirSync(keyDirectory, { recursive: true, mode: 0o700 });
    }
    
    // Ensure we have a master key
    let masterKey: Buffer;
    
    if (options?.masterKey) {
      // Use the provided master key
      masterKey = Buffer.isBuffer(options.masterKey) 
        ? options.masterKey 
        : Buffer.from(options.masterKey);
    } else if (this.config.masterKeyPassword) {
      // Derive a key from the password
      const salt = this.config.masterKeySalt || 'fingerprint-salt';
      masterKey = this.deriveKey(this.config.masterKeyPassword, salt);
    } else {
      // Generate a random key and save it
      masterKey = crypto.randomBytes(32);
      
      // Save the key to a secure location
      const keyPath = path.join(keyDirectory, '.master.key');
      fs.writeFileSync(keyPath, masterKey, { mode: 0o600 });
      
      console.warn(
        'Generated a random master key and saved it to', 
        keyPath, 
        '\nPlease secure this file appropriately.'
      );
    }
    
    return {
      keyDirectory,
      masterKey,
      algorithm: 'aes-256-gcm',
      ...options
    };
  }
  
  /**
   * Get a key provider
   * @param type The type of provider to get
   * @returns The requested key provider
   */
  public getProvider(type: KeyProviderType = this.config.defaultProviderType!): KeyProvider {
    // Check if we already have this provider
    if (this.providers.has(type)) {
      return this.providers.get(type)!;
    }
    
    // Create a new provider
    let provider: KeyProvider;
    
    switch (type) {
      case KeyProviderType.ENV:
        provider = new EnvKeyProvider(this.config.envOptions);
        break;
        
      case KeyProviderType.ENCRYPTED_FILE:
        provider = new EncryptedFileKeyProvider(
          this.initEncryptedFileOptions(this.config.encryptedFileOptions)
        );
        break;
        
      case KeyProviderType.VAULT:
        if (!this.config.vaultOptions?.vaultUrl) {
          throw new Error('Vault URL is required for vault key provider');
        }
        provider = new VaultKeyProvider(this.config.vaultOptions);
        break;
        
      default:
        throw new Error(`Unknown key provider type: ${type}`);
    }
    
    // Store the provider for reuse
    this.providers.set(type, provider);
    
    return provider;
  }
  
  /**
   * Set the default provider type
   * @param type The provider type to use as default
   */
  public setDefaultProviderType(type: KeyProviderType): void {
    this.config.defaultProviderType = type;
  }
  
  /**
   * Update the factory configuration
   * @param config New configuration options
   */
  public updateConfig(config: Partial<KeyProviderFactoryConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      envOptions: {
        ...this.config.envOptions,
        ...config.envOptions
      },
      encryptedFileOptions: {
        ...this.config.encryptedFileOptions,
        ...config.encryptedFileOptions
      },
      vaultOptions: {
        ...this.config.vaultOptions,
        ...config.vaultOptions
      }
    };
  }
}
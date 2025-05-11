/**
 * Security module for the Fingerprint application
 *
 * Provides secure key management following OWASP guidelines:
 * - Secure key storage with appropriate encryption
 * - Key isolation through the KeyProvider interface
 * - Support for different storage backends
 * - Key rotation capabilities
 * - Comprehensive audit logging of security operations
 * - Support for different logging destinations (console, file, remote)
 */

// Export all key management interfaces and classes
export * from './KeyProvider';
export * from './EnvKeyProvider';
export * from './EncryptedFileKeyProvider';
export * from './VaultKeyProvider';
export * from './KeyProviderFactory';
export * from './KeyManager';

// Export audit logger
export * from './AuditLogger';

// Import modules
import { KeyManager } from './KeyManager';
import { AuditLogger } from './AuditLogger';

// Create a Security object as the default export for convenience
const Security = {
  keyManager: KeyManager.getInstance(),
  auditLogger: AuditLogger.getInstance(),

  // Initialize both systems together
  initialize: (masterKeyPassword?: string, environment = 'development') => {
    KeyManager.getInstance().initialize(masterKeyPassword, environment);

    // Configure audit logger based on environment
    const loggerConfig = environment === 'production'
      ? {
          enableConsoleLogging: false,
          enableFileLogging: true,
          enableRemoteLogging: true
        }
      : {
          enableConsoleLogging: true,
          enableFileLogging: false,
          enableRemoteLogging: false
        };

    AuditLogger.getInstance().updateOptions(loggerConfig);

    // Set key manager reference in the audit logger for encrypted logs
    AuditLogger.getInstance().setKeyManager(KeyManager.getInstance());

    return Security;
  }
};

export default Security;
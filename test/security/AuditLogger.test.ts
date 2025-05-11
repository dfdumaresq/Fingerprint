import { describe, expect, it, beforeEach, jest, afterEach } from '@jest/globals';
import { AuditLogger, LogLevel, AuditEventType } from '../../src/security/AuditLogger';
import { KeyManager, KeyType } from '../../src/security/KeyManager';

// Mock KeyManager
jest.mock('../../src/security/KeyManager');

describe('AuditLogger', () => {
  let auditLogger: AuditLogger;
  let consoleDebugSpy: jest.SpyInstance;
  let consoleInfoSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  
  beforeEach(() => {
    // Reset the singleton
    (AuditLogger as any).instance = undefined;
    
    // Spy on console methods
    consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation();
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    
    // Create a new instance
    auditLogger = AuditLogger.getInstance();
  });
  
  afterEach(() => {
    // Restore console methods
    consoleDebugSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
  
  describe('Singleton Pattern', () => {
    it('should return the same instance when getInstance is called multiple times', () => {
      const instance1 = AuditLogger.getInstance();
      const instance2 = AuditLogger.getInstance();
      
      expect(instance1).toBe(instance2);
    });
    
    it('should accept options in getInstance', () => {
      const logger = AuditLogger.getInstance({
        enableConsoleLogging: false,
        minLogLevel: LogLevel.ERROR
      });
      
      // Log something that should be ignored
      logger.log(LogLevel.INFO, AuditEventType.KEY_ACCESS, 'Test operation', 'test-actor');
      
      // Console should not be called because logging is disabled
      expect(consoleInfoSpy).not.toHaveBeenCalled();
    });
  });
  
  describe('Configuration', () => {
    it('should update options', () => {
      // Update options
      auditLogger.updateOptions({
        enableConsoleLogging: false,
        enableFileLogging: true,
        logFilePath: '/tmp/audit.log',
        minLogLevel: LogLevel.ERROR
      });
      
      // Log something that should be ignored due to level
      auditLogger.log(LogLevel.INFO, AuditEventType.KEY_ACCESS, 'Test operation', 'test-actor');
      
      // Console should not be called because level is below minimum
      expect(consoleInfoSpy).not.toHaveBeenCalled();
      
      // Log something at error level
      auditLogger.log(LogLevel.ERROR, AuditEventType.KEY_ACCESS, 'Error operation', 'test-actor');
      
      // Console should not be called because console logging is disabled
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      
      // Debug should be called for the file logging attempt
      expect(consoleDebugSpy).toHaveBeenCalled();
    });
    
    it('should set KeyManager for encrypted logs', () => {
      const mockKeyManager = new KeyManager();
      
      // Set key manager
      auditLogger.setKeyManager(mockKeyManager);
      
      // Update options to enable encrypted logs
      auditLogger.updateOptions({
        encryptLogs: true
      });
      
      // Log something
      auditLogger.log(LogLevel.INFO, AuditEventType.KEY_ACCESS, 'Test operation', 'test-actor');
      
      // Should see a debug message about encrypting logs
      expect(consoleDebugSpy).toHaveBeenCalledWith(expect.stringContaining('encrypt'));
    });
  });
  
  describe('Logging Methods', () => {
    it('should log with appropriate console method based on level', () => {
      // Log at different levels
      auditLogger.log(LogLevel.DEBUG, AuditEventType.KEY_ACCESS, 'Debug operation', 'test-actor');
      auditLogger.log(LogLevel.INFO, AuditEventType.KEY_ACCESS, 'Info operation', 'test-actor');
      auditLogger.log(LogLevel.WARNING, AuditEventType.KEY_ACCESS, 'Warning operation', 'test-actor');
      auditLogger.log(LogLevel.ERROR, AuditEventType.KEY_ACCESS, 'Error operation', 'test-actor');
      auditLogger.log(LogLevel.CRITICAL, AuditEventType.KEY_ACCESS, 'Critical operation', 'test-actor');
      
      // Check that appropriate console methods were called
      expect(consoleDebugSpy).toHaveBeenCalledWith(expect.any(String), expect.any(String));
      expect(consoleInfoSpy).toHaveBeenCalledWith(expect.any(String), expect.any(String));
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.any(String), expect.any(String));
      expect(consoleErrorSpy).toHaveBeenCalledTimes(2); // ERROR and CRITICAL both use console.error
    });
    
    it('should include stack trace for warning and above', () => {
      // Enable stack traces
      auditLogger.updateOptions({
        includeStackTrace: true
      });
      
      // Log at warning level
      auditLogger.log(LogLevel.WARNING, AuditEventType.KEY_ACCESS, 'Warning operation', 'test-actor');
      
      // Check that console.warn was called with a string containing stack trace
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"stackTrace":')
      );
    });
    
    it('should log key access events', () => {
      // Log key access
      auditLogger.logKeyAccess(
        KeyType.WALLET,
        'test-key-id',
        'test-user',
        'read_key',
        true
      );
      
      // Check that console.info was called with appropriate data
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining(AuditEventType.KEY_ACCESS),
        expect.stringContaining('test-key-id')
      );
    });
    
    it('should log blockchain transaction events', () => {
      // Log blockchain transaction
      auditLogger.logBlockchainTransaction(
        'Register fingerprint',
        '0xWalletAddress',
        '0xContractAddress',
        11155111,
        '0xTransactionHash',
        true,
        { fingerprintHash: '0xFingerprintHash' }
      );
      
      // Check that console.info was called with appropriate data
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining(AuditEventType.BLOCKCHAIN_TRANSACTION),
        expect.stringContaining('0xWalletAddress')
      );
    });
    
    it('should log signature events', () => {
      // Log signature generation
      auditLogger.logSignatureEvent(
        true, // isGeneration
        'Generate EIP-712 signature',
        '0xSignerAddress',
        'AgentFingerprint',
        true, // success
        { timestamp: 123456789 }
      );
      
      // Check that console.info was called with appropriate data
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining(AuditEventType.SIGNATURE_GENERATION),
        expect.stringContaining('0xSignerAddress')
      );
      
      // Log signature verification
      auditLogger.logSignatureEvent(
        false, // isGeneration
        'Verify EIP-712 signature',
        '0xVerifierAddress',
        'AgentFingerprint',
        false, // failure
        { timestamp: 123456789 }
      );
      
      // Check that console.warn was called with appropriate data (failure = warning level)
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(AuditEventType.SIGNATURE_VERIFICATION),
        expect.stringContaining('0xVerifierAddress')
      );
    });
  });
  
  describe('Environment Detection', () => {
    it('should detect browser vs server environment', () => {
      // In the test environment, it should be 'server'
      auditLogger.log(LogLevel.INFO, AuditEventType.KEY_ACCESS, 'Test operation', 'test-actor');
      
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"source":"server"')
      );
      
      // Mock window to simulate browser environment
      const originalWindow = global.window;
      global.window = {} as any;
      
      auditLogger.log(LogLevel.INFO, AuditEventType.KEY_ACCESS, 'Browser operation', 'test-actor');
      
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"source":"client"')
      );
      
      // Restore original window
      global.window = originalWindow;
    });
  });
});
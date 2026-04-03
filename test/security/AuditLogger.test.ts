import { describe, expect, it, beforeEach, jest, afterEach } from '@jest/globals';
import { LogLevel, AuditEventType } from '../../src/security/AuditLogger';
import { KeyType } from '../../src/security/KeyManager';

describe('AuditLogger', () => {
  let consoleDebugSpy: jest.Mock;
  let consoleInfoSpy: jest.Mock;
  let consoleWarnSpy: jest.Mock;
  let consoleErrorSpy: jest.Mock;
  let savedWindow: any;

  beforeEach(() => {
    // Save window state
    savedWindow = global.window;
    
    // Spy on console methods
    consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {}) as any;
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {}) as any;
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}) as any;
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {}) as any;
  });

  afterEach(() => {
    // Restore state
    global.window = savedWindow;
    consoleDebugSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  // Helper to get a fresh instance in an isolated module scope
  function getFreshLogger(options?: any, isServer = true) {
    if (isServer) {
        delete (global as any).window;
    } else {
        (global as any).window = {};
    }
    
    let logger: any;
    jest.isolateModules(() => {
      const { AuditLogger } = require('../../src/security/AuditLogger');
      const { KeyManager } = require('../../src/security/KeyManager');
      // Mock KeyManager for the isolation block
      jest.mock('../../src/security/KeyManager');
      logger = AuditLogger.getInstance(options);
    });
    return logger;
  }

  describe('Singleton and Configuration', () => {
    it('should maintain singleton status within an isolation block', () => {
      jest.isolateModules(() => {
        const { AuditLogger } = require('../../src/security/AuditLogger');
        const instance1 = AuditLogger.getInstance();
        const instance2 = AuditLogger.getInstance();
        expect(instance1).toBe(instance2);
      });
    });

    it('should respect minLogLevel configuration', () => {
      const logger = getFreshLogger({ minLogLevel: LogLevel.WARNING });
      consoleInfoSpy.mockClear();
      consoleWarnSpy.mockClear();

      logger.log(LogLevel.INFO, AuditEventType.KEY_ACCESS, 'Ignored info', 'actor');
      expect(consoleInfoSpy).not.toHaveBeenCalled();

      logger.log(LogLevel.WARNING, AuditEventType.KEY_ACCESS, 'Logged warning', 'actor');
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should respect enableConsoleLogging toggle', () => {
      const logger = getFreshLogger({ enableConsoleLogging: false });
      consoleInfoSpy.mockClear();

      logger.log(LogLevel.INFO, AuditEventType.KEY_ACCESS, 'Silent info', 'actor');
      expect(consoleInfoSpy).not.toHaveBeenCalled();
    });
  });

  describe('Metadata and Integrity', () => {
    it('should include session and source metadata', () => {
      const logger = getFreshLogger({ enableConsoleLogging: true }, true); // isServer = true
      consoleInfoSpy.mockClear();

      logger.log(LogLevel.INFO, AuditEventType.KEY_ACCESS, 'Metadata test', 'actor');
      
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"source": "server"')
      );
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"sessionId":')
      );
    });

    it('should reflect "client" source when window is present', () => {
      const logger = getFreshLogger({ enableConsoleLogging: true }, false); // isServer = false (simulated browser)
      consoleInfoSpy.mockClear();

      logger.log(LogLevel.INFO, AuditEventType.KEY_ACCESS, 'Browser test', 'actor');
      
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"source": "client"')
      );
    });
  });

  describe('Specific Event Logging', () => {
    it('should correctly format key access events', () => {
      const logger = getFreshLogger({ enableConsoleLogging: true });
      consoleInfoSpy.mockClear();

      logger.logKeyAccess(KeyType.WALLET, 'test-key-id', 'test-actor');
      
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('key_access'),
        expect.stringContaining('"target": "test-key-id"')
      );
    });

    it('should log blockchain transactions with txHash', () => {
      const logger = getFreshLogger({ enableConsoleLogging: true });
      consoleInfoSpy.mockClear();

      logger.logBlockchainTransaction('send', 'actor', 'contract', 1, '0xhash');
      
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('blockchain_transaction'),
        expect.stringContaining('"txHash": "0xhash"')
      );
    });
  });

  describe('File Logging and Encryption', () => {
    it('should indicate encryption when enabled and KeyManager is present', () => {
      const logger = getFreshLogger({ 
        enableFileLogging: true, 
        encryptLogs: true,
        enableConsoleLogging: false 
      }, true); // Server environment
      
      const { KeyManager } = require('../../src/security/KeyManager');
      const mockKeyManager = new KeyManager();
      logger.setKeyManager(mockKeyManager);
      
      consoleDebugSpy.mockClear();
      logger.log(LogLevel.INFO, AuditEventType.KEY_ACCESS, 'Encrypt test', 'actor');
      
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Would encrypt')
      );
    });
  });
});

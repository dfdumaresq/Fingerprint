import { KeyManager, KeyType } from './KeyManager';

/**
 * Log entry severity levels
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical'
}

/**
 * Log entry types for categorizing audit events
 */
export enum AuditEventType {
  KEY_ACCESS = 'key_access',
  KEY_CREATION = 'key_creation',
  KEY_ROTATION = 'key_rotation',
  KEY_DELETION = 'key_deletion',
  BLOCKCHAIN_TRANSACTION = 'blockchain_transaction',
  SIGNATURE_GENERATION = 'signature_generation',
  SIGNATURE_VERIFICATION = 'signature_verification',
  CONTRACT_INTERACTION = 'contract_interaction',
  WALLET_CONNECTION = 'wallet_connection',
  CONFIGURATION_CHANGE = 'configuration_change',
  ADMIN_ACTION = 'admin_action'
}

/**
 * Audit log entry interface
 */
export interface AuditLogEntry {
  timestamp: string;
  level: LogLevel;
  eventType: AuditEventType;
  operation: string;
  actor: string;
  target?: string;
  result: 'success' | 'failure';
  details?: Record<string, any>;
  sessionId?: string;
  source?: string;
}

/**
 * Audit logger configuration options
 */
export interface AuditLoggerOptions {
  enableConsoleLogging?: boolean;
  enableFileLogging?: boolean;
  logFilePath?: string;
  enableRemoteLogging?: boolean;
  remoteLogEndpoint?: string;
  remoteLogApiKey?: string;
  minLogLevel?: LogLevel;
  includeStackTrace?: boolean;
  logRotationSizeMB?: number;
  encryptLogs?: boolean;
  encryptionKeyId?: string;
}

/**
 * Audit logger for secure operations
 * 
 * This class provides a centralized way to log security-related events
 * in a consistent format that can be easily audited.
 */
export class AuditLogger {
  private static instance: AuditLogger;
  private options: AuditLoggerOptions;
  private sessionId: string;
  private keyManager?: KeyManager;
  
  /**
   * Create a new audit logger
   * @private
   */
  private constructor(options: AuditLoggerOptions = {}) {
    // Safe environment access that works in both Node.js and browser environments
    const env = typeof process !== 'undefined' && process.env ? process.env : {};
    const nodeEnv = env.NODE_ENV;
    const isProduction = nodeEnv === 'production';

    this.options = {
      enableConsoleLogging: !isProduction,
      enableFileLogging: isProduction,
      logFilePath: env.AUDIT_LOG_PATH || './logs/audit.log',
      enableRemoteLogging: env.ENABLE_REMOTE_LOGGING === 'true',
      remoteLogEndpoint: env.REMOTE_LOG_ENDPOINT,
      minLogLevel: LogLevel.INFO,
      includeStackTrace: !isProduction,
      logRotationSizeMB: 10,
      encryptLogs: env.ENCRYPT_AUDIT_LOGS === 'true',
      ...options
    };
    
    // Generate a unique session ID for this instance
    this.sessionId = this.generateSessionId();
    
    // Log the logger initialization
    this.log(
      LogLevel.INFO,
      AuditEventType.CONFIGURATION_CHANGE,
      'Audit logger initialized',
      'system',
      'audit_logger',
      'success',
      { options: { ...this.options, remoteLogApiKey: this.options.remoteLogApiKey ? '[REDACTED]' : undefined } }
    );
  }
  
  /**
   * Get the singleton instance of the audit logger
   * @param options Optional configuration options
   * @returns The audit logger instance
   */
  public static getInstance(options?: AuditLoggerOptions): AuditLogger {
    if (!AuditLogger.instance) {
      AuditLogger.instance = new AuditLogger(options);
    } else if (options) {
      // Update options if provided
      AuditLogger.instance.updateOptions(options);
    }
    return AuditLogger.instance;
  }
  
  /**
   * Update the logger options
   * @param options New configuration options
   */
  public updateOptions(options: Partial<AuditLoggerOptions>): void {
    const oldOptions = { ...this.options };
    this.options = { ...this.options, ...options };
    
    // Log the configuration change
    this.log(
      LogLevel.INFO,
      AuditEventType.CONFIGURATION_CHANGE,
      'Audit logger configuration updated',
      'system',
      'audit_logger',
      'success',
      { 
        oldOptions: { ...oldOptions, remoteLogApiKey: oldOptions.remoteLogApiKey ? '[REDACTED]' : undefined },
        newOptions: { ...this.options, remoteLogApiKey: this.options.remoteLogApiKey ? '[REDACTED]' : undefined } 
      }
    );
  }
  
  /**
   * Set the key manager for encrypted logging
   * @param keyManager The key manager instance
   */
  public setKeyManager(keyManager: KeyManager): void {
    this.keyManager = keyManager;
  }
  
  /**
   * Generate a unique session ID
   * @returns A unique session ID
   * @private
   */
  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }
  
  /**
   * Log an audit event
   * @param level The severity level of the event
   * @param eventType The type of event
   * @param operation Description of the operation
   * @param actor The identity performing the operation
   * @param target Optional target of the operation (e.g., contract address, file path)
   * @param result Whether the operation succeeded or failed
   * @param details Optional additional details about the operation
   */
  public log(
    level: LogLevel,
    eventType: AuditEventType,
    operation: string,
    actor: string,
    target?: string,
    result: 'success' | 'failure' = 'success',
    details?: Record<string, any>
  ): void {
    // Skip logging if level is below minimum
    const levels = Object.values(LogLevel);
    if (levels.indexOf(level) < levels.indexOf(this.options.minLogLevel || LogLevel.INFO)) {
      return;
    }
    
    // Create the log entry
    const logEntry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      eventType,
      operation,
      actor,
      target,
      result,
      details,
      sessionId: this.sessionId,
      source: typeof window === 'undefined' ? 'server' : 'client'
    };
    
    // Add stack trace if enabled and level is warning or higher
    if (this.options.includeStackTrace && 
        (level === LogLevel.WARNING || level === LogLevel.ERROR || level === LogLevel.CRITICAL)) {
      const stackTrace = new Error().stack;
      if (stackTrace && !logEntry.details) {
        logEntry.details = { stackTrace };
      } else if (stackTrace && logEntry.details) {
        logEntry.details.stackTrace = stackTrace;
      }
    }
    
    // Process the log entry through each enabled destination
    this.processLogEntry(logEntry);
  }
  
  /**
   * Process a log entry through all configured destinations
   * @param logEntry The log entry to process
   * @private
   */
  private processLogEntry(logEntry: AuditLogEntry): void {
    // Create a function to stringify the log entry consistently
    const stringifyEntry = () => JSON.stringify(logEntry, null, 2);
    
    // Console logging
    if (this.options.enableConsoleLogging) {
      const consoleMethod = this.getConsoleMethodForLevel(logEntry.level);
      consoleMethod(`[AUDIT] ${logEntry.eventType}:`, stringifyEntry());
    }
    
    // File logging
    if (this.options.enableFileLogging && typeof window === 'undefined') {
      this.writeToLogFile(logEntry);
    }
    
    // Remote logging
    if (this.options.enableRemoteLogging && this.options.remoteLogEndpoint) {
      this.sendToRemoteEndpoint(logEntry);
    }
  }
  
  /**
   * Get the appropriate console method for the log level
   * @param level The log level
   * @returns The console method to use
   * @private
   */
  private getConsoleMethodForLevel(level: LogLevel): (...args: any[]) => void {
    switch (level) {
      case LogLevel.DEBUG:
        return console.debug;
      case LogLevel.INFO:
        return console.info;
      case LogLevel.WARNING:
        return console.warn;
      case LogLevel.ERROR:
      case LogLevel.CRITICAL:
        return console.error;
      default:
        return console.log;
    }
  }
  
  /**
   * Write a log entry to the configured log file
   * This is a placeholder and would be implemented with fs in Node.js
   * @param logEntry The log entry to write
   * @private
   */
  private writeToLogFile(logEntry: AuditLogEntry): void {
    // Skip if running in browser environment
    if (typeof window !== 'undefined') {
      console.debug('[AUDIT] File logging not available in browser environment');
      return;
    }

    // This would be implemented with fs in Node.js
    // For now, we'll just log this fact
    if (this.options.encryptLogs && this.keyManager) {
      console.debug(`[AUDIT] Would encrypt and write to log file: ${this.options.logFilePath}`);
    } else {
      console.debug(`[AUDIT] Would write to log file: ${this.options.logFilePath}`);
    }

    // In a real implementation, you would use the Node.js fs module:
    // const fs = require('fs');
    // const logString = JSON.stringify(logEntry);
    // fs.appendFileSync(this.options.logFilePath, logString + '\n');
  }
  
  /**
   * Send a log entry to a remote logging endpoint
   * This is a placeholder and would be implemented with fetch or similar
   * @param logEntry The log entry to send
   * @private
   */
  private sendToRemoteEndpoint(logEntry: AuditLogEntry): void {
    // This would be implemented with fetch or similar
    // For now, we'll just log this fact
    console.debug(`[AUDIT] Would send to remote endpoint: ${this.options.remoteLogEndpoint}`);
  }
  
  /**
   * Log a key access event
   * @param keyType The type of key accessed
   * @param keyId The ID of the key accessed
   * @param actor The identity accessing the key
   * @param operation The operation being performed
   * @param success Whether the operation succeeded
   */
  public logKeyAccess(
    keyType: KeyType,
    keyId: string,
    actor: string,
    operation = 'key_read',
    success = true
  ): void {
    this.log(
      success ? LogLevel.INFO : LogLevel.WARNING,
      AuditEventType.KEY_ACCESS,
      operation,
      actor,
      keyId,
      success ? 'success' : 'failure',
      { keyType }
    );
  }
  
  /**
   * Log a blockchain transaction event
   * @param operation The operation description
   * @param actor The address or identity performing the operation
   * @param contractAddress The contract address
   * @param chainId The blockchain network ID
   * @param txHash The transaction hash
   * @param success Whether the transaction succeeded
   * @param details Additional details about the transaction
   */
  public logBlockchainTransaction(
    operation: string,
    actor: string,
    contractAddress: string,
    chainId: number,
    txHash?: string,
    success = true,
    details?: Record<string, any>
  ): void {
    this.log(
      success ? LogLevel.INFO : LogLevel.WARNING,
      AuditEventType.BLOCKCHAIN_TRANSACTION,
      operation,
      actor,
      contractAddress,
      success ? 'success' : 'failure',
      {
        chainId,
        txHash,
        ...details
      }
    );
  }
  
  /**
   * Log a signature event (generation or verification)
   * @param isGeneration Whether this is a signature generation (true) or verification (false)
   * @param operation The operation description
   * @param actor The address or identity performing the operation
   * @param dataType The type of data being signed
   * @param success Whether the operation succeeded
   * @param details Additional details about the signature
   */
  public logSignatureEvent(
    isGeneration: boolean,
    operation: string,
    actor: string,
    dataType: string,
    success = true,
    details?: Record<string, any>
  ): void {
    this.log(
      success ? LogLevel.INFO : LogLevel.WARNING,
      isGeneration ? AuditEventType.SIGNATURE_GENERATION : AuditEventType.SIGNATURE_VERIFICATION,
      operation,
      actor,
      dataType,
      success ? 'success' : 'failure',
      details
    );
  }
}
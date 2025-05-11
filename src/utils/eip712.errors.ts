/**
 * Typed error classes for EIP-712 operations
 */

/**
 * Base class for all EIP-712 errors
 */
export class EIP712Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EIP712Error';
    
    // Maintain proper stack trace in Node.js
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error thrown when trying to sign a message with invalid parameters
 */
export class EIP712SigningError extends EIP712Error {
  public readonly cause?: Error;
  
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'EIP712SigningError';
    this.cause = cause;
  }
}

/**
 * Error thrown when domain parameters are invalid
 */
export class EIP712DomainError extends EIP712Error {
  public readonly domain: unknown;
  
  constructor(message: string, domain: unknown) {
    super(message);
    this.name = 'EIP712DomainError';
    this.domain = domain;
  }
}

/**
 * Error thrown when typed data message is invalid
 */
export class EIP712MessageError extends EIP712Error {
  public readonly invalidMessage: unknown;
  public readonly errors?: string[];
  
  constructor(message: string, invalidMessage: unknown, errors?: string[]) {
    super(message);
    this.name = 'EIP712MessageError';
    this.invalidMessage = invalidMessage;
    this.errors = errors;
  }
}

/**
 * Error thrown when trying to verify a signature
 */
export class EIP712VerificationError extends EIP712Error {
  public readonly signature: string;
  public readonly cause?: Error;
  
  constructor(message: string, signature: string, cause?: Error) {
    super(message);
    this.name = 'EIP712VerificationError';
    this.signature = signature;
    this.cause = cause;
  }
}

/**
 * Error thrown when the wallet connection is not available
 */
export class WalletNotConnectedError extends EIP712Error {
  constructor(message = 'Wallet is not connected') {
    super(message);
    this.name = 'WalletNotConnectedError';
  }
}

/**
 * Error thrown when the user rejects a signature request
 */
export class UserRejectedSignatureError extends EIP712Error {
  constructor(message = 'User rejected the signature request') {
    super(message);
    this.name = 'UserRejectedSignatureError';
  }
}

/**
 * Create a proper error from an unknown error
 * @param error The unknown error to convert
 * @param defaultMessage Default message to use if the error doesn't have a message
 * @returns A proper Error object
 */
export function createProperError(error: unknown, defaultMessage = 'Unknown error'): Error {
  if (error instanceof Error) {
    return error;
  }
  
  let message: string;
  
  if (typeof error === 'string') {
    message = error;
  } else if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    message = error.message;
  } else {
    message = defaultMessage;
  }
  
  return new Error(message);
}

/**
 * Helper function to detect user rejection errors from different wallet providers
 * @param error The error to check
 * @returns True if the error is a user rejection error
 */
export function isUserRejectionError(error: unknown): boolean {
  if (!error) return false;
  
  // Convert to a proper Error object if it isn't one already
  const err = createProperError(error);
  
  // Check for common patterns in user rejection errors
  if (
    /user denied/i.test(err.message) ||
    /user rejected/i.test(err.message) ||
    /user cancelled/i.test(err.message) ||
    /user denied transaction/i.test(err.message) ||
    /rejected by user/i.test(err.message) ||
    err.message.includes('EIP-1193') ||  // Some providers use EIP-1193 error codes
    err.message.includes('code: 4001')   // MetaMask user rejection code
  ) {
    return true;
  }
  
  // Check for specific error codes in the object
  if (typeof error === 'object' && error !== null) {
    const objError = error as any;
    // MetaMask and similar providers
    if (objError.code === 4001 || objError.code === -32603) {
      return true;
    }
  }
  
  return false;
}
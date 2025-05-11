/**
 * Typed error classes for EIP-712 operations
 * Provides a standardized error hierarchy for EIP-712 related operations
 */

/**
 * Base class for all EIP-712 errors
 * Extends the standard Error class with EIP-712 specific handling
 */
export class EIP712Error extends Error {
  /**
   * Error code for categorization and programmatic handling
   */
  public readonly code: string;

  /**
   * Create a new EIP-712 error
   * @param message Human-readable error message
   * @param code Optional error code for programmatic handling
   */
  constructor(message: string, code = 'EIP712_ERROR') {
    super(message);
    this.name = 'EIP712Error';
    this.code = code;

    // Maintain proper stack trace in Node.js
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    // Fix prototype chain for ES5 environments
    Object.setPrototypeOf(this, EIP712Error.prototype);
  }

  /**
   * Format the error for logging or display
   * @returns Formatted error string with code
   */
  public toString(): string {
    return `${this.name} [${this.code}]: ${this.message}`;
  }

  /**
   * Convert to a serializable object
   * @returns Plain object representation of the error
   */
  public toJSON(): Record<string, any> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      stack: this.stack
    };
  }
}

/**
 * Error thrown when trying to sign a message with invalid parameters
 */
export class EIP712SigningError extends EIP712Error {
  /**
   * The original error that caused this signing error
   */
  public readonly cause?: Error;

  /**
   * Create a new signing error
   * @param message Human-readable error message
   * @param cause Optional original error that caused this error
   * @param code Optional error code for programmatic handling
   */
  constructor(message: string, cause?: Error, code = 'EIP712_SIGNING_ERROR') {
    super(message, code);
    this.name = 'EIP712SigningError';
    this.cause = cause;

    // Fix prototype chain
    Object.setPrototypeOf(this, EIP712SigningError.prototype);
  }

  /**
   * Convert to a serializable object including cause
   * @returns Plain object representation of the error
   */
  public override toJSON(): Record<string, any> {
    return {
      ...super.toJSON(),
      cause: this.cause instanceof Error ?
        {
          name: this.cause.name,
          message: this.cause.message,
          stack: this.cause.stack
        } :
        this.cause
    };
  }
}

/**
 * Error thrown when domain parameters are invalid
 */
export class EIP712DomainError extends EIP712Error {
  /**
   * The invalid domain object that caused this error
   */
  public readonly domain: unknown;

  /**
   * Specific validation errors found in the domain
   */
  public readonly errors?: string[];

  /**
   * Create a new domain error
   * @param message Human-readable error message
   * @param domain The invalid domain that caused this error
   * @param errors Optional array of specific validation errors
   * @param code Optional error code for programmatic handling
   */
  constructor(
    message: string,
    domain: unknown,
    errors?: string[],
    code = 'EIP712_DOMAIN_ERROR'
  ) {
    super(message, code);
    this.name = 'EIP712DomainError';
    this.domain = domain;
    this.errors = errors;

    // Fix prototype chain
    Object.setPrototypeOf(this, EIP712DomainError.prototype);
  }

  /**
   * Convert to a serializable object including domain info
   * @returns Plain object representation of the error
   */
  public override toJSON(): Record<string, any> {
    return {
      ...super.toJSON(),
      domain: this.domain,
      errors: this.errors
    };
  }
}

/**
 * Error thrown when typed data message is invalid
 */
export class EIP712MessageError extends EIP712Error {
  /**
   * The invalid message that caused this error
   */
  public readonly invalidMessage: unknown;

  /**
   * Specific validation errors found in the message
   */
  public readonly errors?: string[];

  /**
   * Create a new message error
   * @param message Human-readable error message
   * @param invalidMessage The invalid message that caused this error
   * @param errors Optional array of specific validation errors
   * @param code Optional error code for programmatic handling
   */
  constructor(
    message: string,
    invalidMessage: unknown,
    errors?: string[],
    code = 'EIP712_MESSAGE_ERROR'
  ) {
    super(message, code);
    this.name = 'EIP712MessageError';
    this.invalidMessage = invalidMessage;
    this.errors = errors;

    // Fix prototype chain
    Object.setPrototypeOf(this, EIP712MessageError.prototype);
  }

  /**
   * Convert to a serializable object including message info
   * @returns Plain object representation of the error
   */
  public override toJSON(): Record<string, any> {
    return {
      ...super.toJSON(),
      invalidMessage: this.invalidMessage,
      errors: this.errors
    };
  }
}

/**
 * Error thrown when trying to verify a signature
 */
export class EIP712VerificationError extends EIP712Error {
  /**
   * The signature that failed verification
   */
  public readonly signature: string;

  /**
   * The original error that caused this verification error
   */
  public readonly cause?: Error;

  /**
   * Create a new verification error
   * @param message Human-readable error message
   * @param signature The signature that failed verification
   * @param cause Optional original error that caused this error
   * @param code Optional error code for programmatic handling
   */
  constructor(
    message: string,
    signature: string,
    cause?: Error,
    code = 'EIP712_VERIFICATION_ERROR'
  ) {
    super(message, code);
    this.name = 'EIP712VerificationError';
    this.signature = signature;
    this.cause = cause;

    // Fix prototype chain
    Object.setPrototypeOf(this, EIP712VerificationError.prototype);
  }

  /**
   * Convert to a serializable object including signature info
   * @returns Plain object representation of the error
   */
  public override toJSON(): Record<string, any> {
    return {
      ...super.toJSON(),
      signature: this.signature,
      cause: this.cause instanceof Error ?
        {
          name: this.cause.name,
          message: this.cause.message,
          stack: this.cause.stack
        } :
        this.cause
    };
  }
}

/**
 * Error thrown when the wallet connection is not available
 */
export class WalletNotConnectedError extends EIP712Error {
  /**
   * Create a new wallet connection error
   * @param message Human-readable error message
   * @param code Optional error code for programmatic handling
   */
  constructor(message = 'Wallet is not connected', code = 'WALLET_NOT_CONNECTED') {
    super(message, code);
    this.name = 'WalletNotConnectedError';

    // Fix prototype chain
    Object.setPrototypeOf(this, WalletNotConnectedError.prototype);
  }
}

/**
 * Error thrown when the user rejects a signature request
 */
export class UserRejectedSignatureError extends EIP712Error {
  /**
   * Create a new user rejection error
   * @param message Human-readable error message
   * @param code Optional error code for programmatic handling
   */
  constructor(message = 'User rejected the signature request', code = 'USER_REJECTED') {
    super(message, code);
    this.name = 'UserRejectedSignatureError';

    // Fix prototype chain
    Object.setPrototypeOf(this, UserRejectedSignatureError.prototype);
  }
}

/**
 * Create a proper Error object from an unknown error value
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

  // If it's already our specific user rejection error
  if (error instanceof UserRejectedSignatureError) {
    return true;
  }

  // Convert to a proper Error object if it isn't one already
  const err = createProperError(error);

  // Check for common patterns in user rejection errors
  if (
    /user denied/i.test(err.message) ||
    /user rejected/i.test(err.message) ||
    /user cancelled/i.test(err.message) ||
    /user denied transaction/i.test(err.message) ||
    /rejected by user/i.test(err.message) ||
    /user rejected/i.test(err.message) ||
    err.message.includes('EIP-1193') ||  // Some providers use EIP-1193 error codes
    err.message.includes('code: 4001')   // MetaMask user rejection code
  ) {
    return true;
  }

  // Check for specific error codes in the object
  if (typeof error === 'object' && error !== null) {
    const objError = error as Record<string, any>;

    // Check common error codes
    // MetaMask and similar providers
    if (
      objError.code === 4001 || // MetaMask user rejection
      objError.code === -32603 || // Internal JSON-RPC error
      objError.code === 'ACTION_REJECTED' // WalletConnect rejection
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Wraps an unknown error in the appropriate EIP712Error subclass
 * @param error The unknown error to wrap
 * @param defaultMessage Default message to use if the error doesn't have a message
 * @returns An appropriate EIP712Error instance
 */
export function wrapError(error: unknown, defaultMessage = 'EIP-712 operation failed'): EIP712Error {
  // If it's already an EIP712Error, return it
  if (error instanceof EIP712Error) {
    return error;
  }

  // Check for user rejection first
  if (isUserRejectionError(error)) {
    return new UserRejectedSignatureError();
  }

  // Convert to a proper Error
  const properError = createProperError(error, defaultMessage);

  // Return a generic EIP712Error
  return new EIP712Error(properError.message);
}
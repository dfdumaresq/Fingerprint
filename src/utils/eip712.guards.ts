/**
 * Type guards and validation utilities for EIP-712 typed data
 * Provides runtime type checking to complement TypeScript static types
 */
import {
  TypedDataField,
  TypedDataTypes,
  EIP712Domain,
  AgentFingerprintMessage,
  TypedData
} from './eip712.utils';
import { EIP712MessageError } from './eip712.errors';

/**
 * Check if a value is a valid TypedDataField
 * @param field The value to check
 * @returns True if the value is a valid TypedDataField
 */
export function isTypedDataField(field: unknown): field is TypedDataField {
  return (
    typeof field === 'object' &&
    field !== null &&
    'name' in field &&
    'type' in field &&
    typeof (field as any).name === 'string' &&
    typeof (field as any).type === 'string'
  );
}

/**
 * Check if a value is a valid TypedDataTypes object
 * @param types The value to check
 * @returns True if the value is a valid TypedDataTypes object
 */
export function isTypedDataTypes(types: unknown): types is TypedDataTypes {
  if (typeof types !== 'object' || types === null) {
    return false;
  }

  // Check if it has at least one valid type definition with fields
  try {
    const typesObj = types as Record<string, unknown>;
    return Object.entries(typesObj).some(([typeName, fieldArray]) =>
      // Each type must have at least one field defined
      Array.isArray(fieldArray) &&
      fieldArray.length > 0 &&
      fieldArray.every(isTypedDataField)
    );
  } catch {
    return false;
  }
}

/**
 * Validate Ethereum address format
 * @param address The string to validate as an Ethereum address
 * @returns True if the string is a valid Ethereum address
 */
export function isValidEthereumAddress(address: unknown): boolean {
  return (
    typeof address === 'string' &&
    /^0x[0-9a-fA-F]{40}$/.test(address)
  );
}

/**
 * Check if a value is a valid EIP-712 domain
 * @param domain The value to check
 * @returns True if the value is a valid EIP712Domain
 */
export function isEIP712Domain(domain: unknown): domain is EIP712Domain {
  if (
    typeof domain !== 'object' ||
    domain === null
  ) {
    return false;
  }

  const typedDomain = domain as Record<string, unknown>;

  // Check required string fields
  if (
    typeof typedDomain.name !== 'string' ||
    typeof typedDomain.version !== 'string'
  ) {
    return false;
  }

  // Validate chainId - must be a positive integer
  if (
    typeof typedDomain.chainId !== 'number' ||
    !Number.isInteger(typedDomain.chainId) ||
    typedDomain.chainId <= 0
  ) {
    return false;
  }

  // Validate verifyingContract as Ethereum address
  if (!isValidEthereumAddress(typedDomain.verifyingContract)) {
    return false;
  }

  return true;
}

/**
 * Check if a value is a valid AgentFingerprintMessage
 * @param message The value to check
 * @returns True if the value is a valid AgentFingerprintMessage
 */
export function isAgentFingerprintMessage(message: unknown): message is AgentFingerprintMessage {
  if (
    typeof message !== 'object' ||
    message === null
  ) {
    return false;
  }

  const typedMessage = message as Record<string, unknown>;

  // Check all required string fields are present and are strings
  if (
    typeof typedMessage.id !== 'string' ||
    typeof typedMessage.name !== 'string' ||
    typeof typedMessage.provider !== 'string' ||
    typeof typedMessage.version !== 'string'
  ) {
    return false;
  }

  // Validate timestamp is a positive integer
  return (
    typeof typedMessage.timestamp === 'number' &&
    Number.isInteger(typedMessage.timestamp) &&
    typedMessage.timestamp > 0
  );
}

/**
 * Check if a value is a valid EIP-712 TypedData
 * @param data The value to check
 * @returns True if the value is a valid TypedData
 */
export function isTypedData<T extends Record<string, any>>(data: unknown): data is TypedData<T> {
  if (
    typeof data !== 'object' ||
    data === null
  ) {
    return false;
  }

  const typedData = data as Record<string, unknown>;

  // Check required primaryType string
  if (typeof typedData.primaryType !== 'string' || !typedData.primaryType) {
    return false;
  }

  // Validate types and domain
  if (
    !isTypedDataTypes(typedData.types) ||
    !isEIP712Domain(typedData.domain)
  ) {
    return false;
  }

  // Check message is an object
  if (
    typeof typedData.message !== 'object' ||
    typedData.message === null
  ) {
    return false;
  }

  return true;
}

/**
 * Validate an EIP-712 signature format
 * @param signature The string to validate as an EIP-712 signature
 * @returns True if the string is a valid EIP-712 signature format
 */
export function isValidEIP712Signature(signature: unknown): boolean {
  return (
    typeof signature === 'string' &&
    /^0x[0-9a-fA-F]{130}$/.test(signature)
  );
}

/**
 * Validate agent fingerprint message fields in depth
 * (beyond just type checking)
 * @param message The message to validate
 * @returns An array of error messages or an empty array if valid
 * @throws EIP712MessageError if the message is not a valid AgentFingerprintMessage
 */
export function validateAgentFingerprintMessage(message: AgentFingerprintMessage): string[] {
  // First, verify basic structure with type guard
  if (!isAgentFingerprintMessage(message)) {
    throw new EIP712MessageError(
      'Invalid message format: not a valid AgentFingerprintMessage',
      message
    );
  }

  const errors: string[] = [];

  // Check for empty strings
  if (!message.id.trim()) {
    errors.push('Agent ID cannot be empty');
  }

  if (!message.name.trim()) {
    errors.push('Agent name cannot be empty');
  }

  if (!message.provider.trim()) {
    errors.push('Provider cannot be empty');
  }

  if (!message.version.trim()) {
    errors.push('Version cannot be empty');
  }

  // Validate timestamp is reasonable
  const now = Math.floor(Date.now() / 1000);

  // Allow 2 minutes in the future for clock skew
  if (message.timestamp > now + 120) {
    errors.push('Timestamp is too far in the future');
  }

  // Reject timestamps more than 1 year old
  if (message.timestamp < now - 31536000) {
    errors.push('Timestamp is too old');
  }

  return errors;
}

/**
 * Performs deep validation of domain parameters
 * @param domain The domain to validate
 * @returns An array of error messages or an empty array if valid
 */
export function validateEIP712Domain(domain: EIP712Domain): string[] {
  // First, verify basic structure with type guard
  if (!isEIP712Domain(domain)) {
    return ['Invalid domain format: not a valid EIP712Domain'];
  }

  const errors: string[] = [];

  // Check for empty strings
  if (!domain.name.trim()) {
    errors.push('Domain name cannot be empty');
  }

  if (!domain.version.trim()) {
    errors.push('Domain version cannot be empty');
  }

  // Check chain ID
  if (domain.chainId <= 0) {
    errors.push('Chain ID must be a positive integer');
  }

  // Check contract address (beyond basic format)
  if (domain.verifyingContract === '0x0000000000000000000000000000000000000000') {
    errors.push('Verifying contract cannot be the zero address');
  }

  return errors;
}
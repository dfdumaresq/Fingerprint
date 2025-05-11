/**
 * Type guards and validation utilities for EIP-712 typed data
 */
import { 
  TypedDataField,
  TypedDataTypes,
  EIP712Domain, 
  AgentFingerprintMessage,
  TypedData
} from './eip712.utils';

/**
 * Check if a value is a valid TypedDataField
 */
export function isTypedDataField(field: any): field is TypedDataField {
  return (
    typeof field === 'object' &&
    field !== null &&
    typeof field.name === 'string' &&
    typeof field.type === 'string'
  );
}

/**
 * Check if a value is a valid TypedDataTypes object
 */
export function isTypedDataTypes(types: any): types is TypedDataTypes {
  if (typeof types !== 'object' || types === null) {
    return false;
  }

  // Check if it has at least one valid type definition
  return Object.values(types).some(fieldArray => 
    Array.isArray(fieldArray) && fieldArray.every(isTypedDataField)
  );
}

/**
 * Check if a value is a valid EIP-712 domain
 */
export function isEIP712Domain(domain: any): domain is EIP712Domain {
  return (
    typeof domain === 'object' &&
    domain !== null &&
    typeof domain.name === 'string' &&
    typeof domain.version === 'string' &&
    typeof domain.chainId === 'number' &&
    typeof domain.verifyingContract === 'string' &&
    domain.verifyingContract.startsWith('0x')
  );
}

/**
 * Check if a value is a valid AgentFingerprintMessage
 */
export function isAgentFingerprintMessage(message: any): message is AgentFingerprintMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    typeof message.id === 'string' &&
    typeof message.name === 'string' &&
    typeof message.provider === 'string' &&
    typeof message.version === 'string' &&
    typeof message.timestamp === 'number' &&
    Number.isInteger(message.timestamp) &&
    message.timestamp > 0
  );
}

/**
 * Check if a value is a valid EIP-712 TypedData
 */
export function isTypedData<T extends Record<string, any>>(data: any): data is TypedData<T> {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof data.primaryType === 'string' &&
    isTypedDataTypes(data.types) &&
    isEIP712Domain(data.domain) &&
    typeof data.message === 'object' &&
    data.message !== null
  );
}

/**
 * Validate an Ethereum address
 */
export function isValidEthereumAddress(address: string): boolean {
  return (
    typeof address === 'string' &&
    /^0x[0-9a-fA-F]{40}$/.test(address)
  );
}

/**
 * Validate an EIP-712 signature
 */
export function isValidEIP712Signature(signature: string): boolean {
  return (
    typeof signature === 'string' &&
    /^0x[0-9a-fA-F]{130}$/.test(signature)
  );
}

/**
 * Validate agent fingerprint message fields
 * @returns An array of error messages or an empty array if valid
 */
export function validateAgentFingerprintMessage(message: AgentFingerprintMessage): string[] {
  const errors: string[] = [];

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

  const now = Math.floor(Date.now() / 1000);
  if (message.timestamp > now + 120) { // Allow 2 minutes in the future for clock skew
    errors.push('Timestamp is too far in the future');
  }

  if (message.timestamp < now - 31536000) { // Older than 1 year
    errors.push('Timestamp is too old');
  }

  return errors;
}
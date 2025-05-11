import { describe, expect, it, jest } from '@jest/globals';
import {
  TypedDataField,
  TypedDataTypes,
  EIP712Domain,
  AgentFingerprintMessage,
  AGENT_FINGERPRINT_TYPES,
  TypedData,
  createEIP712Domain,
  createAgentFingerprintMessage,
  createAgentFingerprintTypedData,
  hashAgentFingerprint
} from '../../src/utils/eip712.utils';
import {
  isTypedDataField,
  isTypedDataTypes,
  isEIP712Domain,
  isAgentFingerprintMessage,
  isTypedData,
  isValidEthereumAddress,
  isValidEIP712Signature,
  validateAgentFingerprintMessage,
  validateEIP712Domain
} from '../../src/utils/eip712.guards';
import {
  EIP712Error,
  EIP712SigningError,
  EIP712DomainError,
  EIP712MessageError,
  EIP712VerificationError,
  WalletNotConnectedError,
  UserRejectedSignatureError,
  isUserRejectionError,
  createProperError,
  wrapError
} from '../../src/utils/eip712.errors';

// Test data
const validChainId = 11155111; // Sepolia testnet
const validContractAddress = '0x1234567890123456789012345678901234567890';
const validDomain: EIP712Domain = {
  name: 'AIFingerprint',
  version: '1',
  chainId: validChainId,
  verifyingContract: validContractAddress
};
const validAgent = {
  id: 'agent-123',
  name: 'Test Agent',
  provider: 'Test Provider',
  version: '1.0.0'
};

describe('EIP-712 Typed Data Implementation', () => {
  describe('Type correctness', () => {
    it('should define correct TypedDataField interface', () => {
      const field: TypedDataField = {
        name: 'testField',
        type: 'string'
      };

      expect(field.name).toBe('testField');
      expect(field.type).toBe('string');
      expect(isTypedDataField(field)).toBe(true);
    });

    it('should define correct TypedDataTypes interface', () => {
      const types: TypedDataTypes = {
        TestType: [
          { name: 'field1', type: 'string' },
          { name: 'field2', type: 'uint256' }
        ]
      };

      expect(types.TestType.length).toBe(2);
      expect(isTypedDataTypes(types)).toBe(true);
    });

    it('should define correct EIP712Domain interface', () => {
      const domain: EIP712Domain = {
        name: 'TestDomain',
        version: '1',
        chainId: 1,
        verifyingContract: '0x1234567890123456789012345678901234567890'
      };

      expect(domain.name).toBe('TestDomain');
      expect(isEIP712Domain(domain)).toBe(true);
    });

    it('should define correct AgentFingerprintMessage interface', () => {
      const message: AgentFingerprintMessage = {
        id: 'test-id',
        name: 'Test Agent',
        provider: 'Test Provider',
        version: '1.0',
        timestamp: Math.floor(Date.now() / 1000)
      };

      expect(message.id).toBe('test-id');
      expect(isAgentFingerprintMessage(message)).toBe(true);
    });

    it('should define correct TypedData interface', () => {
      const message = createAgentFingerprintMessage(validAgent);

      const typedData: TypedData<AgentFingerprintMessage> = {
        types: AGENT_FINGERPRINT_TYPES,
        primaryType: 'AgentFingerprint',
        domain: validDomain,
        message
      };

      expect(typedData.primaryType).toBe('AgentFingerprint');
      expect(isTypedData(typedData)).toBe(true);
    });
  });

  describe('Domain parameter validation', () => {
    it('should create valid domain from parameters', () => {
      const domain = createEIP712Domain(validChainId, validContractAddress);

      expect(domain.name).toBe('AIFingerprint');
      expect(domain.version).toBe('1');
      expect(domain.chainId).toBe(validChainId);
      expect(domain.verifyingContract).toBe(validContractAddress);
      expect(isEIP712Domain(domain)).toBe(true);
    });

    it('should handle bigint chainId', () => {
      const bigIntChainId = BigInt(validChainId);
      const domain = createEIP712Domain(bigIntChainId, validContractAddress);

      expect(domain.chainId).toBe(validChainId);
      expect(typeof domain.chainId).toBe('number');
    });

    it('should validate domain parameters', () => {
      // Valid domain
      expect(isEIP712Domain(validDomain)).toBe(true);

      // Invalid domains
      expect(isEIP712Domain(null)).toBe(false);
      expect(isEIP712Domain({})).toBe(false);
      expect(isEIP712Domain({ ...validDomain, chainId: '1' })).toBe(false);
      expect(isEIP712Domain({ ...validDomain, verifyingContract: 'not-an-address' })).toBe(false);
    });

    it('should throw an error when creating domain with invalid parameters', () => {
      // Invalid contract address
      expect(() => {
        createEIP712Domain(validChainId, 'invalid-address');
      }).toThrow(EIP712Error);

      // Invalid chainId
      expect(() => {
        createEIP712Domain('not-a-number' as unknown as number, validContractAddress);
      }).toThrow(EIP712Error);
    });

    it('should validate domain in depth with validateEIP712Domain', () => {
      // Valid domain should have no errors
      expect(validateEIP712Domain(validDomain).length).toBe(0);

      // Zero address should trigger error
      const zeroAddressDomain = {
        ...validDomain,
        verifyingContract: '0x0000000000000000000000000000000000000000'
      };
      expect(validateEIP712Domain(zeroAddressDomain).length).toBeGreaterThan(0);

      // Empty name should trigger error
      const emptyNameDomain = {
        ...validDomain,
        name: ''
      };
      expect(validateEIP712Domain(emptyNameDomain).length).toBeGreaterThan(0);
    });
  });

  describe('Message creation and validation', () => {
    it('should create valid agent message', () => {
      const message = createAgentFingerprintMessage(validAgent);

      expect(message.id).toBe(validAgent.id);
      expect(message.name).toBe(validAgent.name);
      expect(message.provider).toBe(validAgent.provider);
      expect(message.version).toBe(validAgent.version);
      expect(message.timestamp).toBeGreaterThan(0);
      expect(isAgentFingerprintMessage(message)).toBe(true);
    });

    it('should validate agent message', () => {
      const message = createAgentFingerprintMessage(validAgent);

      // Valid message
      expect(isAgentFingerprintMessage(message)).toBe(true);

      // Invalid messages
      expect(isAgentFingerprintMessage(null)).toBe(false);
      expect(isAgentFingerprintMessage({})).toBe(false);
      expect(isAgentFingerprintMessage({ ...message, id: 123 })).toBe(false); // Wrong type
      expect(isAgentFingerprintMessage({ ...message, timestamp: 'now' })).toBe(false); // Wrong type
    });

    it('should detect empty values in message validation', () => {
      const message = createAgentFingerprintMessage(validAgent);
      const emptyIdMessage = { ...message, id: '' };
      const errors = validateAgentFingerprintMessage(emptyIdMessage);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('ID cannot be empty');
    });

    it('should detect future timestamps in message validation', () => {
      const message = createAgentFingerprintMessage(validAgent);
      const futureTimestamp = Math.floor(Date.now() / 1000) + 600; // 10 minutes in the future
      const futureMessage = { ...message, timestamp: futureTimestamp };
      const errors = validateAgentFingerprintMessage(futureMessage);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('too far in the future');
    });

    it('should detect old timestamps in message validation', () => {
      const message = createAgentFingerprintMessage(validAgent);
      const oldTimestamp = Math.floor(Date.now() / 1000) - 31536001; // Older than 1 year
      const oldMessage = { ...message, timestamp: oldTimestamp };
      const errors = validateAgentFingerprintMessage(oldMessage);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('too old');
    });

    it('should throw when validating non-message object', () => {
      const invalidMessage = { id: 123 } as unknown as AgentFingerprintMessage; // Not a valid message

      expect(() => {
        validateAgentFingerprintMessage(invalidMessage);
      }).toThrow(EIP712MessageError);
    });
  });

  describe('Create TypedData', () => {
    it('should create full typed data object', () => {
      const typedData = createAgentFingerprintTypedData(validChainId, validContractAddress, validAgent);

      expect(typedData.types).toBe(AGENT_FINGERPRINT_TYPES);
      expect(typedData.primaryType).toBe('AgentFingerprint');
      expect(typedData.domain.chainId).toBe(validChainId);
      expect(typedData.domain.verifyingContract).toBe(validContractAddress);
      expect(typedData.message.id).toBe(validAgent.id);
      expect(typedData.message.timestamp).toBeGreaterThan(0);
    });

    it('should hash typed data correctly', () => {
      const message = createAgentFingerprintMessage(validAgent);
      const hash = hashAgentFingerprint(validDomain, message);

      // Hash should be a hex string starting with 0x
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/i);
    });

    it('should throw on invalid hash inputs', () => {
      const message = createAgentFingerprintMessage(validAgent);

      // Invalid domain
      const invalidDomain = { ...validDomain, verifyingContract: 'not-an-address' };
      expect(() => {
        hashAgentFingerprint(invalidDomain, message);
      }).toThrow(EIP712Error);

      // Invalid message
      const invalidMessage = { ...message, timestamp: 'now' as unknown as number };
      expect(() => {
        hashAgentFingerprint(validDomain, invalidMessage);
      }).toThrow(EIP712Error);
    });
  });

  describe('Error handling', () => {
    it('should create proper error from unknown error', () => {
      // String error
      const stringError = createProperError('String error');
      expect(stringError.message).toBe('String error');

      // Object with message
      const objError = createProperError({ message: 'Object error' });
      expect(objError.message).toBe('Object error');

      // Unknown object
      const unknownError = createProperError({});
      expect(unknownError.message).toBe('Unknown error');

      // Existing Error
      const existingError = new Error('Existing error');
      const returnedError = createProperError(existingError);
      expect(returnedError).toBe(existingError);
    });

    it('should detect user rejection errors', () => {
      // Common error patterns
      expect(isUserRejectionError({ message: 'user denied transaction' })).toBe(true);
      expect(isUserRejectionError({ message: 'User rejected request' })).toBe(true);
      expect(isUserRejectionError({ code: 4001 })).toBe(true);
      expect(isUserRejectionError({ code: 'ACTION_REJECTED' })).toBe(true);

      // Already a UserRejectedSignatureError
      const rejectionError = new UserRejectedSignatureError();
      expect(isUserRejectionError(rejectionError)).toBe(true);

      // Not user rejection errors
      expect(isUserRejectionError({ message: 'some other error' })).toBe(false);
      expect(isUserRejectionError(null)).toBe(false);
    });

    it('should wrap unknown errors in EIP712Error', () => {
      // String error
      const wrappedString = wrapError('Error message');
      expect(wrappedString).toBeInstanceOf(EIP712Error);
      expect(wrappedString.message).toBe('Error message');

      // Object error
      const wrappedObject = wrapError({ message: 'Object error' });
      expect(wrappedObject).toBeInstanceOf(EIP712Error);
      expect(wrappedObject.message).toBe('Object error');

      // Existing EIP712Error should be returned as-is
      const existingError = new EIP712DomainError('Domain error', {});
      const wrappedExisting = wrapError(existingError);
      expect(wrappedExisting).toBe(existingError);

      // User rejection should be wrapped in UserRejectedSignatureError
      const wrappedRejection = wrapError({ message: 'user denied transaction' });
      expect(wrappedRejection).toBeInstanceOf(UserRejectedSignatureError);
    });
  });

  describe('Utility validations', () => {
    it('should validate Ethereum addresses', () => {
      expect(isValidEthereumAddress('0x1234567890123456789012345678901234567890')).toBe(true);
      expect(isValidEthereumAddress('0x123456789012345678901234567890123456789')).toBe(false); // Too short
      expect(isValidEthereumAddress('0x12345678901234567890123456789012345678901')).toBe(false); // Too long
      expect(isValidEthereumAddress('1234567890123456789012345678901234567890')).toBe(false); // Missing 0x
      expect(isValidEthereumAddress('0xg234567890123456789012345678901234567890')).toBe(false); // Invalid char

      // Non-string values
      expect(isValidEthereumAddress(123)).toBe(false);
      expect(isValidEthereumAddress(null)).toBe(false);
      expect(isValidEthereumAddress(undefined)).toBe(false);
    });

    it('should validate EIP-712 signatures', () => {
      const validSig = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1c';
      expect(isValidEIP712Signature(validSig)).toBe(true);

      expect(isValidEIP712Signature('invalid')).toBe(false);
      expect(isValidEIP712Signature('0x1234')).toBe(false); // Too short
      expect(isValidEIP712Signature('1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1c')).toBe(false); // Missing 0x

      // Non-string values
      expect(isValidEIP712Signature(123)).toBe(false);
      expect(isValidEIP712Signature(null)).toBe(false);
      expect(isValidEIP712Signature(undefined)).toBe(false);
    });
  });

  describe('EIP-712 Error classes', () => {
    it('should create base EIP-712 error with code', () => {
      const error = new EIP712Error('Base error');
      expect(error.message).toBe('Base error');
      expect(error.name).toBe('EIP712Error');
      expect(error.code).toBe('EIP712_ERROR');
      expect(error instanceof Error).toBe(true);

      // With custom code
      const customCodeError = new EIP712Error('Custom code error', 'CUSTOM_CODE');
      expect(customCodeError.code).toBe('CUSTOM_CODE');

      // Test toString and toJSON
      expect(error.toString()).toContain('[EIP712_ERROR]');
      const jsonError = error.toJSON();
      expect(jsonError.name).toBe('EIP712Error');
      expect(jsonError.code).toBe('EIP712_ERROR');
      expect(jsonError.message).toBe('Base error');
    });

    it('should create EIP-712 signing error with cause', () => {
      const cause = new Error('Cause');
      const error = new EIP712SigningError('Signing error', cause);

      expect(error.message).toBe('Signing error');
      expect(error.name).toBe('EIP712SigningError');
      expect(error.code).toBe('EIP712_SIGNING_ERROR');
      expect(error.cause).toBe(cause);
      expect(error instanceof Error).toBe(true);
      expect(error instanceof EIP712Error).toBe(true);

      // With custom code
      const customCodeError = new EIP712SigningError('Custom code', cause, 'CUSTOM_SIGNING');
      expect(customCodeError.code).toBe('CUSTOM_SIGNING');

      // Test toJSON with cause
      const jsonError = error.toJSON();
      expect(jsonError.cause.message).toBe('Cause');
    });

    it('should create EIP-712 domain error with validation errors', () => {
      const invalidDomain = { name: 'Test' };
      const errors = ['Missing chainId', 'Invalid contract address'];
      const error = new EIP712DomainError('Domain error', invalidDomain, errors);

      expect(error.message).toBe('Domain error');
      expect(error.name).toBe('EIP712DomainError');
      expect(error.code).toBe('EIP712_DOMAIN_ERROR');
      expect(error.domain).toBe(invalidDomain);
      expect(error.errors).toBe(errors);
      expect(error instanceof Error).toBe(true);
      expect(error instanceof EIP712Error).toBe(true);

      // Test toJSON with domain and errors
      const jsonError = error.toJSON();
      expect(jsonError.domain).toBe(invalidDomain);
      expect(jsonError.errors).toBe(errors);
    });

    it('should create EIP-712 message error with validation errors', () => {
      const invalidMessage = { id: 123 };
      const errors = ['Invalid id type'];
      const error = new EIP712MessageError('Message error', invalidMessage, errors);

      expect(error.message).toBe('Message error');
      expect(error.name).toBe('EIP712MessageError');
      expect(error.code).toBe('EIP712_MESSAGE_ERROR');
      expect(error.invalidMessage).toBe(invalidMessage);
      expect(error.errors).toBe(errors);
      expect(error instanceof Error).toBe(true);
      expect(error instanceof EIP712Error).toBe(true);

      // Test toJSON with message and errors
      const jsonError = error.toJSON();
      expect(jsonError.invalidMessage).toBe(invalidMessage);
      expect(jsonError.errors).toBe(errors);
    });

    it('should create EIP-712 verification error with cause', () => {
      const cause = new Error('Cause');
      const error = new EIP712VerificationError('Verification error', 'invalid-signature', cause);

      expect(error.message).toBe('Verification error');
      expect(error.name).toBe('EIP712VerificationError');
      expect(error.code).toBe('EIP712_VERIFICATION_ERROR');
      expect(error.signature).toBe('invalid-signature');
      expect(error.cause).toBe(cause);
      expect(error instanceof Error).toBe(true);
      expect(error instanceof EIP712Error).toBe(true);

      // Test toJSON with signature and cause
      const jsonError = error.toJSON();
      expect(jsonError.signature).toBe('invalid-signature');
      expect(jsonError.cause.message).toBe('Cause');
    });

    it('should create wallet not connected error with default message', () => {
      const error = new WalletNotConnectedError();

      expect(error.message).toBe('Wallet is not connected');
      expect(error.name).toBe('WalletNotConnectedError');
      expect(error.code).toBe('WALLET_NOT_CONNECTED');
      expect(error instanceof Error).toBe(true);
      expect(error instanceof EIP712Error).toBe(true);

      // With custom message
      const customError = new WalletNotConnectedError('Custom message');
      expect(customError.message).toBe('Custom message');

      // With custom code
      const customCodeError = new WalletNotConnectedError('Custom message', 'CUSTOM_WALLET');
      expect(customCodeError.code).toBe('CUSTOM_WALLET');
    });

    it('should create user rejected signature error with default message', () => {
      const error = new UserRejectedSignatureError();

      expect(error.message).toBe('User rejected the signature request');
      expect(error.name).toBe('UserRejectedSignatureError');
      expect(error.code).toBe('USER_REJECTED');
      expect(error instanceof Error).toBe(true);
      expect(error instanceof EIP712Error).toBe(true);

      // With custom message
      const customError = new UserRejectedSignatureError('Custom message');
      expect(customError.message).toBe('Custom message');

      // With custom code
      const customCodeError = new UserRejectedSignatureError('Custom message', 'CUSTOM_REJECTION');
      expect(customCodeError.code).toBe('CUSTOM_REJECTION');
    });
  });
});
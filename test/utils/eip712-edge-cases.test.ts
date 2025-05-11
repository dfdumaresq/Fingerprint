/**
 * Tests for edge cases in EIP-712 implementation
 * These tests focus on boundary conditions and unexpected input values
 */
import { describe, expect, it, jest } from '@jest/globals';
import {
  AgentFingerprintMessage,
  EIP712Domain,
  AGENT_FINGERPRINT_TYPES,
  createEIP712Domain,
  createAgentFingerprintMessage,
  hashAgentFingerprint
} from '../../src/utils/eip712.utils';
import {
  isAgentFingerprintMessage,
  isEIP712Domain,
  validateAgentFingerprintMessage,
  isValidEIP712Signature,
  validateEIP712Domain,
  isTypedDataTypes,
  isTypedData
} from '../../src/utils/eip712.guards';
import {
  EIP712MessageError,
  EIP712DomainError,
  EIP712Error
} from '../../src/utils/eip712.errors';

describe('EIP-712 Edge Cases', () => {
  // Test common values
  const validChainId = 11155111;
  const validContractAddress = '0x1234567890123456789012345678901234567890';
  const validDomain: EIP712Domain = {
    name: 'AIFingerprint',
    version: '1',
    chainId: validChainId,
    verifyingContract: validContractAddress
  };
  const validAgentMessage: AgentFingerprintMessage = {
    id: 'agent-123',
    name: 'Test Agent',
    provider: 'Test Provider',
    version: '1.0.0',
    timestamp: Math.floor(Date.now() / 1000)
  };

  describe('Empty string handling', () => {
    it('should detect empty strings in agent data', () => {
      const emptyIdMessage = { ...validAgentMessage, id: '' };
      const emptyNameMessage = { ...validAgentMessage, name: '' };
      const emptyProviderMessage = { ...validAgentMessage, provider: '' };
      const emptyVersionMessage = { ...validAgentMessage, version: '' };

      // All are valid AgentFingerprintMessage objects (isEmpty is not a type issue)
      expect(isAgentFingerprintMessage(emptyIdMessage)).toBe(true);
      expect(isAgentFingerprintMessage(emptyNameMessage)).toBe(true);
      expect(isAgentFingerprintMessage(emptyProviderMessage)).toBe(true);
      expect(isAgentFingerprintMessage(emptyVersionMessage)).toBe(true);

      // Validation should detect empty values
      expect(validateAgentFingerprintMessage(emptyIdMessage).length).toBeGreaterThan(0);
      expect(validateAgentFingerprintMessage(emptyNameMessage).length).toBeGreaterThan(0);
      expect(validateAgentFingerprintMessage(emptyProviderMessage).length).toBeGreaterThan(0);
      expect(validateAgentFingerprintMessage(emptyVersionMessage).length).toBeGreaterThan(0);
    });

    it('should handle empty strings in domain data', () => {
      const emptyNameDomain = { ...validDomain, name: '' };
      const emptyVersionDomain = { ...validDomain, version: '' };

      // Empty strings are valid for type checking but not for validation
      expect(isEIP712Domain(emptyNameDomain)).toBe(true);
      expect(isEIP712Domain(emptyVersionDomain)).toBe(true);

      // But validateEIP712Domain should catch these
      expect(validateEIP712Domain(emptyNameDomain).length).toBeGreaterThan(0);
      expect(validateEIP712Domain(emptyVersionDomain).length).toBeGreaterThan(0);
    });

    it('should handle whitespace-only strings', () => {
      const whitespaceIdMessage = { ...validAgentMessage, id: '   ' };
      const whitespaceNameMessage = { ...validAgentMessage, name: '\t\n' };

      // Type checks pass for whitespace strings
      expect(isAgentFingerprintMessage(whitespaceIdMessage)).toBe(true);
      expect(isAgentFingerprintMessage(whitespaceNameMessage)).toBe(true);

      // But validation treats them as empty
      expect(validateAgentFingerprintMessage(whitespaceIdMessage).length).toBeGreaterThan(0);
      expect(validateAgentFingerprintMessage(whitespaceNameMessage).length).toBeGreaterThan(0);
    });
  });

  describe('Extremely long string handling', () => {
    it('should handle extremely long agent data', () => {
      // Create a string with 10,000 characters
      const longString = 'a'.repeat(10000);

      const longIdMessage = { ...validAgentMessage, id: longString };
      const longNameMessage = { ...validAgentMessage, name: longString };
      const longProviderMessage = { ...validAgentMessage, provider: longString };
      const longVersionMessage = { ...validAgentMessage, version: longString };

      // All are valid AgentFingerprintMessage objects
      expect(isAgentFingerprintMessage(longIdMessage)).toBe(true);
      expect(isAgentFingerprintMessage(longNameMessage)).toBe(true);
      expect(isAgentFingerprintMessage(longProviderMessage)).toBe(true);
      expect(isAgentFingerprintMessage(longVersionMessage)).toBe(true);

      // Validation doesn't detect long values as errors
      expect(validateAgentFingerprintMessage(longIdMessage).length).toBe(0);
      expect(validateAgentFingerprintMessage(longNameMessage).length).toBe(0);
      expect(validateAgentFingerprintMessage(longProviderMessage).length).toBe(0);
      expect(validateAgentFingerprintMessage(longVersionMessage).length).toBe(0);
    });

    it('should test performance with reasonable hash generation', () => {
      // Create a message with somewhat long strings (but not unreasonable)
      const moderateString = 'a'.repeat(1000);
      const message = {
        ...validAgentMessage,
        id: moderateString,
        name: moderateString
      };

      // Hashing should work without throwing an error
      expect(() => {
        hashAgentFingerprint(validDomain, message);
      }).not.toThrow();
    });
  });

  describe('Non-string and invalid values', () => {
    it('should reject non-string agent fields', () => {
      // @ts-expect-error - Testing runtime behavior with invalid types
      const nonStringIdMessage = { ...validAgentMessage, id: 123 };
      // @ts-expect-error - Testing runtime behavior with invalid types
      const nonStringNameMessage = { ...validAgentMessage, name: true };
      // @ts-expect-error - Testing runtime behavior with invalid types
      const nonStringProviderMessage = { ...validAgentMessage, provider: {} };
      // @ts-expect-error - Testing runtime behavior with invalid types
      const nonStringVersionMessage = { ...validAgentMessage, version: [] };

      expect(isAgentFingerprintMessage(nonStringIdMessage)).toBe(false);
      expect(isAgentFingerprintMessage(nonStringNameMessage)).toBe(false);
      expect(isAgentFingerprintMessage(nonStringProviderMessage)).toBe(false);
      expect(isAgentFingerprintMessage(nonStringVersionMessage)).toBe(false);

      // validateAgentFingerprintMessage should throw when given invalid data
      expect(() => {
        // @ts-expect-error - Testing runtime behavior
        validateAgentFingerprintMessage(nonStringIdMessage);
      }).toThrow(EIP712MessageError);
    });

    it('should reject non-number timestamp', () => {
      // @ts-expect-error - Testing runtime behavior with invalid types
      const nonNumberTimestampMessage = { ...validAgentMessage, timestamp: 'now' };
      expect(isAgentFingerprintMessage(nonNumberTimestampMessage)).toBe(false);
    });

    it('should reject negative or zero timestamp', () => {
      const negativeTimestampMessage = { ...validAgentMessage, timestamp: -1 };
      const zeroTimestampMessage = { ...validAgentMessage, timestamp: 0 };

      expect(isAgentFingerprintMessage(negativeTimestampMessage)).toBe(false);
      expect(isAgentFingerprintMessage(zeroTimestampMessage)).toBe(false);
    });

    it('should reject decimal timestamp', () => {
      const decimalTimestampMessage = { ...validAgentMessage, timestamp: 12345.67 };
      expect(isAgentFingerprintMessage(decimalTimestampMessage)).toBe(false);
    });

    it('should reject missing fields', () => {
      // @ts-expect-error - Missing id
      const missingIdMessage = {
        name: validAgentMessage.name,
        provider: validAgentMessage.provider,
        version: validAgentMessage.version,
        timestamp: validAgentMessage.timestamp
      };

      // @ts-expect-error - Missing timestamp
      const missingTimestampMessage = {
        id: validAgentMessage.id,
        name: validAgentMessage.name,
        provider: validAgentMessage.provider,
        version: validAgentMessage.version
      };

      expect(isAgentFingerprintMessage(missingIdMessage)).toBe(false);
      expect(isAgentFingerprintMessage(missingTimestampMessage)).toBe(false);
    });
  });

  describe('Domain validation edge cases', () => {
    it('should reject invalid contract addresses', () => {
      const tooShortDomain = { ...validDomain, verifyingContract: '0x1234' };
      const noHexPrefixDomain = { ...validDomain, verifyingContract: '1234567890123456789012345678901234567890' };
      const invalidCharsDomain = { ...validDomain, verifyingContract: '0xXYZ4567890123456789012345678901234567890' };

      expect(isEIP712Domain(tooShortDomain)).toBe(false);
      expect(isEIP712Domain(noHexPrefixDomain)).toBe(false);
      expect(isEIP712Domain(invalidCharsDomain)).toBe(false);
    });

    it('should reject invalid chainId values', () => {
      // @ts-expect-error - Testing runtime behavior with string instead of number
      const stringChainIdDomain = { ...validDomain, chainId: '123' };
      // @ts-expect-error - Testing runtime behavior with decimal instead of integer
      const decimalChainIdDomain = { ...validDomain, chainId: 123.45 };
      // @ts-expect-error - Testing runtime behavior with object instead of number
      const objectChainIdDomain = { ...validDomain, chainId: {} };

      expect(isEIP712Domain(stringChainIdDomain)).toBe(false);
      expect(isEIP712Domain(decimalChainIdDomain)).toBe(false);
      expect(isEIP712Domain(objectChainIdDomain)).toBe(false);
    });

    it('should throw errors when creating domains with invalid parameters', () => {
      expect(() => {
        createEIP712Domain(validChainId, 'not-a-valid-address');
      }).toThrow(EIP712Error);

      expect(() => {
        // @ts-expect-error - Testing runtime behavior
        createEIP712Domain('not-a-number', validContractAddress);
      }).toThrow(EIP712Error);

      expect(() => {
        createEIP712Domain(-1, validContractAddress);
      }).toThrow(EIP712Error);
    });
  });

  describe('Signature validation edge cases', () => {
    it('should validate proper EIP-712 signatures', () => {
      const validSig = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1c';
      expect(isValidEIP712Signature(validSig)).toBe(true);
    });

    it('should reject invalid EIP-712 signatures', () => {
      const tooShortSig = '0x1234';
      const noHexPrefix = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1c';
      const invalidChars = '0xXYZ4567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1c';

      expect(isValidEIP712Signature(tooShortSig)).toBe(false);
      expect(isValidEIP712Signature(noHexPrefix)).toBe(false);
      expect(isValidEIP712Signature(invalidChars)).toBe(false);
    });

    it('should reject non-string signature values', () => {
      expect(isValidEIP712Signature(123)).toBe(false);
      expect(isValidEIP712Signature(null)).toBe(false);
      expect(isValidEIP712Signature(undefined)).toBe(false);
      expect(isValidEIP712Signature({})).toBe(false);
    });
  });

  describe('Special character handling', () => {
    it('should handle special characters in agent data', () => {
      const specialIdMessage = { ...validAgentMessage, id: 'agent-"\'<>&' };
      const specialNameMessage = { ...validAgentMessage, name: 'Test Agent 😀' };
      const specialProviderMessage = { ...validAgentMessage, provider: 'Provider\n\r\t' };
      const specialVersionMessage = { ...validAgentMessage, version: '1.0.0\\/' };

      expect(isAgentFingerprintMessage(specialIdMessage)).toBe(true);
      expect(isAgentFingerprintMessage(specialNameMessage)).toBe(true);
      expect(isAgentFingerprintMessage(specialProviderMessage)).toBe(true);
      expect(isAgentFingerprintMessage(specialVersionMessage)).toBe(true);

      // Special chars should not be considered validation errors
      expect(validateAgentFingerprintMessage(specialIdMessage).length).toBe(0);
      expect(validateAgentFingerprintMessage(specialNameMessage).length).toBe(0);
      expect(validateAgentFingerprintMessage(specialProviderMessage).length).toBe(0);
      expect(validateAgentFingerprintMessage(specialVersionMessage).length).toBe(0);
    });

    it('should handle special characters when hashing', () => {
      const emojiMessage = {
        ...validAgentMessage,
        id: '😀😁😂🤣',
        name: '🧪🔬🧬',
        provider: '🌐🌍🌎🌏',
        version: '🚀'
      };

      // Should not throw when hashing
      expect(() => {
        hashAgentFingerprint(validDomain, emojiMessage);
      }).not.toThrow();
    });
  });

  describe('TypedData structure edge cases', () => {
    it('should reject invalid TypedDataTypes structures', () => {
      // Empty types object
      expect(isTypedDataTypes({})).toBe(false);

      // Missing fields
      expect(isTypedDataTypes({
        Test: []
      })).toBe(false);

      // Invalid field types
      expect(isTypedDataTypes({
        Test: [
          // @ts-expect-error
          { wrongKey: 'value' }
        ]
      })).toBe(false);

      // Non-array type definition
      expect(isTypedDataTypes({
        // @ts-expect-error
        Test: 'not-an-array'
      })).toBe(false);
    });

    it('should reject invalid TypedData structures', () => {
      // Missing fields
      expect(isTypedData({
        types: AGENT_FINGERPRINT_TYPES,
        domain: validDomain
        // Missing primaryType and message
      })).toBe(false);

      // Empty primaryType
      expect(isTypedData({
        types: AGENT_FINGERPRINT_TYPES,
        primaryType: '',
        domain: validDomain,
        message: validAgentMessage
      })).toBe(false);

      // Invalid domain
      expect(isTypedData({
        types: AGENT_FINGERPRINT_TYPES,
        primaryType: 'AgentFingerprint',
        domain: { name: 'Test' }, // Invalid domain
        message: validAgentMessage
      })).toBe(false);

      // Invalid types
      expect(isTypedData({
        types: {}, // Invalid types
        primaryType: 'AgentFingerprint',
        domain: validDomain,
        message: validAgentMessage
      })).toBe(false);
    });
  });

  describe('Mixed utility test cases', () => {
    it('should handle undefined/null inputs gracefully', () => {
      expect(isEIP712Domain(undefined)).toBe(false);
      expect(isAgentFingerprintMessage(undefined)).toBe(false);
      expect(isTypedData(undefined)).toBe(false);
      expect(isValidEIP712Signature(undefined)).toBe(false);
    });

    it('should reject objects with missing required properties', () => {
      const partialDomain = {
        name: 'Test',
        version: '1'
        // Missing chainId and verifyingContract
      };
      expect(isEIP712Domain(partialDomain)).toBe(false);

      const partialMessage = {
        id: 'test',
        name: 'Test'
        // Missing other fields
      };
      expect(isAgentFingerprintMessage(partialMessage)).toBe(false);
    });

    it('should create valid messages from valid agent data', () => {
      // Test with minimal valid agent data
      const minimalAgent = {
        id: 'min-id',
        name: 'Minimal',
        provider: 'Test',
        version: '1.0'
      };

      const message = createAgentFingerprintMessage(minimalAgent);
      expect(isAgentFingerprintMessage(message)).toBe(true);
      expect(validateAgentFingerprintMessage(message).length).toBe(0);
    });
  });
});
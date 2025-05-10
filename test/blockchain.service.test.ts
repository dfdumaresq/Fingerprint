import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { BlockchainService } from '../src/services/blockchain.service';
import { BlockchainConfig } from '../src/types';

// Mock ethers.js
jest.mock('ethers', () => {
  return {
    JsonRpcProvider: jest.fn().mockImplementation(() => ({
      _network: { chainId: 11155111 }
    })),
    Contract: jest.fn().mockImplementation(() => ({
      target: '0x1234567890123456789012345678901234567890',
      verifyFingerprint: jest.fn(),
      verifyFingerprintExtended: jest.fn(),
      isRevoked: jest.fn()
    })),
    BrowserProvider: jest.fn().mockImplementation(() => ({
      getSigner: jest.fn().mockResolvedValue({
        getAddress: jest.fn().mockResolvedValue('0x1234567890123456789012345678901234567890'),
        signTypedData: jest.fn().mockResolvedValue('0xsignature')
      })
    })),
    toUtf8Bytes: jest.fn().mockReturnValue(new Uint8Array()),
    keccak256: jest.fn().mockReturnValue('0xhash'),
    verifyTypedData: jest.fn().mockReturnValue('0x1234567890123456789012345678901234567890')
  };
});

// Mock window.ethereum
Object.defineProperty(window, 'ethereum', {
  value: {
    request: jest.fn().mockImplementation((obj) => {
      if (obj.method === 'eth_chainId') return '0xaa36a7'; // Sepolia testnet in hex
      if (obj.method === 'eth_accounts' || obj.method === 'eth_requestAccounts') {
        return ['0x1234567890123456789012345678901234567890'];
      }
      return null;
    })
  },
  writable: true
});

describe('BlockchainService', () => {
  let service: BlockchainService;
  let mockConfig: BlockchainConfig;

  beforeEach(() => {
    mockConfig = {
      networkUrl: 'https://example.com',
      chainId: 11155111,
      contractAddress: '0x1234567890123456789012345678901234567890'
    };
    service = new BlockchainService(mockConfig);
  });

  describe('Revocation Functionality', () => {
    it('should check if a fingerprint is revoked', async () => {
      // Mock contract isRevoked response
      (service as any).contract.isRevoked.mockResolvedValue([true, 123456789, '0x1234567890123456789012345678901234567890']);

      const result = await service.isRevoked('0xfingerprint');

      expect(result).toEqual({
        revoked: true,
        revokedAt: 123456789,
        revokedBy: '0x1234567890123456789012345678901234567890'
      });
    });

    it('should return null for non-revoked fingerprints', async () => {
      // Mock contract isRevoked response for non-revoked fingerprint
      (service as any).contract.isRevoked.mockResolvedValue([false, 0, '0x0000000000000000000000000000000000000000']);

      const result = await service.isRevoked('0xfingerprint');

      expect(result).toBeNull();
    });

    it('should handle revocation errors gracefully', async () => {
      // Mock contract isRevoked throwing an error
      (service as any).contract.isRevoked.mockRejectedValue(new Error('Contract error'));

      const result = await service.isRevoked('0xfingerprint');

      expect(result).toBeNull();
    });

    it('should revoke a fingerprint when using a compatible contract', async () => {
      // Set a contract target that is not the production contract
      (service as any).contract.target = '0x1111111111111111111111111111111111111111';

      // Mock contract with signer
      const mockContract = {
        target: '0x1111111111111111111111111111111111111111',
        revokeFingerprint: jest.fn().mockResolvedValue({
          hash: '0xtxhash',
          wait: jest.fn().mockResolvedValue({ blockNumber: 123456 })
        })
      };

      // Mock ethers.Contract constructor to return our mock
      (require('ethers').Contract as jest.Mock).mockReturnValueOnce(mockContract);

      const result = await service.revokeFingerprint('0xfingerprint');

      expect(result).toBe(true);
      expect(mockContract.revokeFingerprint).toHaveBeenCalledWith('0xfingerprint');
    });

    it('should not allow revoking on a contract without revocation support', async () => {
      // Mock supportsRevocation to return false
      jest.spyOn(service, 'supportsRevocation').mockResolvedValue(false);

      await expect(service.revokeFingerprint('0xfingerprint'))
        .rejects
        .toThrow('The current contract deployment does not support revocation');
    });

    it('should return null when checking revocation status on a contract without revocation support', async () => {
      // Mock supportsRevocation to return false
      jest.spyOn(service, 'supportsRevocation').mockResolvedValue(false);

      const result = await service.isRevoked('0xfingerprint');

      expect(result).toBeNull();
    });

    it('should handle revocation transaction failures', async () => {
      // Mock contract with signer that throws an error
      const mockContract = {
        revokeFingerprint: jest.fn().mockRejectedValue(new Error('Transaction failed'))
      };

      // Mock ethers.Contract constructor to return our mock
      (require('ethers').Contract as jest.Mock).mockReturnValueOnce(mockContract);

      const result = await service.revokeFingerprint('0xfingerprint');

      expect(result).toBe(false);
    });
  });

  describe('Verification with Revocation Status', () => {
    it('should check revocation status when verifying a fingerprint - extended version', async () => {
      // Mock verifyFingerprintExtended contract method
      (service as any).contract.verifyFingerprintExtended.mockResolvedValue([
        true, 'id', 'name', 'provider', 'version', 123456789, false, 0
      ]);

      const result = await service.verifyFingerprint('0xfingerprint');

      expect(result).toEqual({
        id: 'id',
        name: 'name',
        provider: 'provider',
        version: 'version',
        fingerprintHash: '0xfingerprint',
        createdAt: 123456789,
        revoked: false,
        revokedAt: 0
      });
    });

    it('should check revocation status separately when extended verification is not available', async () => {
      // Mock verifyFingerprintExtended to throw error (not supported)
      (service as any).contract.verifyFingerprintExtended.mockRejectedValue(new Error('Not supported'));

      // Mock basic verifyFingerprint to succeed
      (service as any).contract.verifyFingerprint.mockResolvedValue([
        true, 'id', 'name', 'provider', 'version', 123456789
      ]);

      // Mock isRevoked to return revocation data
      (service as any).contract.isRevoked.mockResolvedValue([true, 987654321, '0x9876543210987654321098765432109876543210']);

      const result = await service.verifyFingerprint('0xfingerprint');

      expect(result).toEqual({
        id: 'id',
        name: 'name',
        provider: 'provider',
        version: 'version',
        fingerprintHash: '0xfingerprint',
        createdAt: 123456789,
        revoked: true,
        revokedAt: 987654321,
        revokedBy: '0x9876543210987654321098765432109876543210'
      });
    });

    it('should handle when both extended and revocation check fail', async () => {
      // Mock verifyFingerprintExtended to throw error (not supported)
      (service as any).contract.verifyFingerprintExtended.mockRejectedValue(new Error('Not supported'));

      // Mock basic verifyFingerprint to succeed
      (service as any).contract.verifyFingerprint.mockResolvedValue([
        true, 'id', 'name', 'provider', 'version', 123456789
      ]);

      // Mock isRevoked to throw error (not supported)
      (service as any).contract.isRevoked.mockRejectedValue(new Error('Not supported'));

      const result = await service.verifyFingerprint('0xfingerprint');

      // Should still return valid data but without revocation info
      expect(result).toEqual({
        id: 'id',
        name: 'name',
        provider: 'provider',
        version: 'version',
        fingerprintHash: '0xfingerprint',
        createdAt: 123456789
      });
    });

    it('should skip revocation check when contract does not support revocation', async () => {
      // Mock feature support
      jest.spyOn(service, 'supportsRevocation').mockResolvedValue(false);
      jest.spyOn(service, 'supportsExtendedVerification').mockResolvedValue(false);

      // Mock basic verifyFingerprint to succeed
      (service as any).contract.verifyFingerprint.mockResolvedValue([
        true, 'id', 'name', 'provider', 'version', 123456789
      ]);

      const result = await service.verifyFingerprint('0xfingerprint');

      // Should return valid data without trying to check revocation
      expect(result).toEqual({
        id: 'id',
        name: 'name',
        provider: 'provider',
        version: 'version',
        fingerprintHash: '0xfingerprint',
        createdAt: 123456789
      });
      // isRevoked should not be called
      expect((service as any).contract.isRevoked).not.toHaveBeenCalled();
    });
  });
});
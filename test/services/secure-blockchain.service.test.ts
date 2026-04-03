import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { BlockchainConfig } from '../../src/types';

describe('SecureBlockchainService', () => {
    let SecureBlockchainService: any;
    let service: any;
    let mockConfig: BlockchainConfig;
    let mockContract: any;

    beforeEach(() => {
        jest.isolateModules(() => {
            mockContract = {
                target: "0x1234",
                verifyFingerprint: jest.fn(),
                verifyFingerprintExtended: jest.fn(),
                isRevoked: jest.fn(),
                registerFingerprint: jest.fn(),
            };

            jest.doMock('ethers', () => ({
                JsonRpcProvider: jest.fn().mockImplementation(() => ({
                    _network: { chainId: 11155111 },
                    getNetwork: (jest.fn() as any).mockResolvedValue({ chainId: 11155111 }),
                })),
                Contract: jest.fn().mockImplementation(() => ({})),
                BrowserProvider: jest.fn().mockImplementation(() => ({
                    getSigner: jest.fn<any>().mockResolvedValue({
                        getAddress: jest.fn<any>().mockResolvedValue("0x1234"),
                    }),
                })),
                toUtf8Bytes: jest.fn((s) => Buffer.from(s as string)),
                keccak256: jest.fn(() => "0xhash"),
            }));

            jest.doMock('../../src/security/KeyManager', () => ({
                KeyManager: {
                    getInstance: jest.fn().mockReturnValue({
                        getKey: (jest.fn() as any).mockResolvedValue('0xkey'),
                        storeKey: jest.fn(),
                    })
                }
            }));

            jest.doMock('../../src/security/AuditLogger', () => ({
                AuditLogger: {
                    getInstance: jest.fn().mockReturnValue({
                        log: jest.fn(),
                        logBlockchainTransaction: jest.fn(),
                    })
                }
            }));

            const mod = require('../../src/services/secure-blockchain.service');
            SecureBlockchainService = mod.SecureBlockchainService;
        });

        mockConfig = {
            networkUrl: "https://example.com",
            chainId: 11155111,
            contractAddress: "0x1234567890123456789012345678901234567890",
            name: "Sepolia Testnet",
        };

        service = new SecureBlockchainService(mockConfig);
        service.contract = mockContract;
        Object.defineProperty(service, 'isConnected', { value: true, writable: true });
        
        service.supportsRevocation = (jest.fn() as any).mockResolvedValue(true);
        service.supportsExtendedVerification = (jest.fn() as any).mockResolvedValue(true);
    });

    it('should register a fingerprint and log audit', async () => {
        mockContract.registerFingerprint.mockResolvedValue({
            hash: "0xtxhash",
            wait: jest.fn<any>().mockResolvedValue({ blockNumber: 123456 }),
        });

        (service as any).connectedWalletAddress = "0x1234";

        const success = await service.registerFingerprint({
            id: 'agent-1',
            name: 'Agent One',
            provider: 'Provider',
            version: '1.0',
            fingerprintHash: '0xhash'
        });
        
        expect(success).toBe(true);
        expect(mockContract.registerFingerprint).toHaveBeenCalled();
    });

    it('should verify fingerprint successfully', async () => {
        mockContract.verifyFingerprintExtended.mockResolvedValue([
            true, 'agent-1', 'Agent One', 'Provider', '1.0', BigInt(1600000000), false, BigInt(0)
        ]);

        const agent = await service.verifyFingerprint('0xactualhash');
        
        expect(agent).not.toBeNull();
        expect(agent?.id).toBe('agent-1');
    });

    it('should check revocation successfully', async () => {
        mockContract.isRevoked.mockResolvedValue([
            true, 
            BigInt(1700000000), 
            '0xrevoker'
        ]);

        const revocation = await service.isRevoked('0xactualhash');
        
        expect(revocation).not.toBeNull();
        expect(revocation?.revoked).toBe(true);
    });
});

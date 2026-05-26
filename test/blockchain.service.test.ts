import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { BlockchainConfig } from '../src/types';

describe('BlockchainService', () => {
    let BlockchainService: any;
    let service: any;
    let mockConfig: BlockchainConfig;
    let mockContract: any;

    beforeEach(async () => {
        jest.resetModules();
        
        mockContract = {
            target: "0x1234",
            verifyFingerprint: jest.fn(),
            verifyFingerprintExtended: jest.fn(),
            isRevoked: jest.fn(),
            getBehavioralTraitData: jest.fn(),
            supportsRevocation: jest.fn(),
            supportsExtendedVerification: jest.fn(),
            filters: {
                BehavioralTraitRegistered: jest.fn(),
                BehavioralTraitUpdated: jest.fn(),
            },
            queryFilter: (jest.fn() as any).mockResolvedValue([]),
        };

        // Basic mock to prevent constructor from throwing
        jest.doMock('ethers', () => ({
            JsonRpcProvider: jest.fn().mockImplementation(() => ({
                _network: { chainId: 11155111 },
                getNetwork: (jest.fn() as any).mockResolvedValue({ chainId: 11155111 }),
            })),
            Contract: jest.fn().mockImplementation(() => mockContract),
            toUtf8Bytes: jest.fn((s: string) => Buffer.from(s)),
            keccak256: jest.fn(() => "0xhash"),
        }));

        const mod = await import('../src/services/blockchain.service');
        BlockchainService = mod.BlockchainService;

        mockConfig = {
            networkUrl: "https://example.com",
            chainId: 11155111,
            contractAddress: "0x1234567890123456789012345678901234567890",
            name: "Sepolia Testnet",
        };

        service = new BlockchainService(mockConfig);
        
        // MANUALLY OVERWRITE THE PUBLIC PROPERTIES FOR ABSOLUTE CONTROL
        service.contract = mockContract;
        Object.defineProperty(service, 'isConnected', { value: true, writable: true });
        
        // Stub feature detection on the instance
        service.supportsRevocation = (jest.fn() as any).mockResolvedValue(true);
        service.supportsExtendedVerification = (jest.fn() as any).mockResolvedValue(true);
    });

    it('should correctly process revocation record', async () => {
        mockContract.isRevoked.mockResolvedValue([
            true, 
            BigInt(1700000000), 
            '0xrevoker'
        ]);

        const revocation = await service.isRevoked('0xactualhash');
        
        expect(revocation).not.toBeNull();
        expect(revocation?.revoked).toBe(true);
        expect(revocation?.revokedAt).toBe(1700000000);
    });

    it('should verify fingerprint data', async () => {
        mockContract.verifyFingerprintExtended.mockResolvedValue([
            true, 'agent-1', 'Agent One', 'Provider', '1.0', BigInt(1600000000), false, BigInt(0)
        ]);
        mockContract.getBehavioralTraitData.mockResolvedValue([false, '', '', BigInt(0), BigInt(0)]);

        const agent = await service.verifyFingerprint('0xactualhash');
        
        expect(agent).not.toBeNull();
        expect(agent?.id).toBe('agent-1');
    });

    it('should fetch registered agents in sandbox mode', async () => {
        service.setSandboxMode(true);
        const agentPayload = {
            id: 'mock-agent-id',
            name: 'MockAgent',
            provider: 'MockProvider',
            version: '1.0.0',
            fingerprintHash: '0xmockhash123'
        };
        await service.registerFingerprint(agentPayload);

        const list = await service.getRegisteredAgents();
        expect(list.length).toBe(1);
        expect(list[0].id).toBe('mock-agent-id');
        expect(list[0].name).toBe('MockAgent');
    });

    it('should fetch registered agents in live blockchain mode', async () => {
        mockContract.filters.FingerprintRegistered = jest.fn().mockReturnValue('filter-signature');
        mockContract.queryFilter.mockResolvedValue([
            {
                args: [
                    '0xhash123',
                    'agent-live-1',
                    'LiveAgentOne',
                    'LiveProvider',
                    '1.1',
                    '0xregisteredByAddress',
                    BigInt(1650000000)
                ]
            }
        ]);

        mockContract.isRevoked.mockResolvedValue([false, BigInt(0), '0x0000000000000000000000000000000000000000']);
        mockContract.getBehavioralTraitData.mockResolvedValue([true, '0xtraithash', 'reasoning-v1.0', BigInt(1650000000), BigInt(1650000000)]);

        const list = await service.getRegisteredAgents();
        expect(list.length).toBe(1);
        expect(list[0].id).toBe('agent-live-1');
        expect(list[0].name).toBe('LiveAgentOne');
        expect(list[0].behavioralTraitHash).toBe('0xtraithash');
        expect(list[0].revoked).toBe(false);
    });
});


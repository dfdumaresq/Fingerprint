// src/contexts/BlockchainContext.ts
import React, { createContext, useState, useContext, useEffect } from 'react';
import { BlockchainService } from '../services/blockchain.service';
import { BlockchainConfig, NetworkType, Agent, VerificationResult } from '../types';

// Define structured response types for CopilotKit actions
interface BlockchainActionResult<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    details?: string;
}

// Define the context type
interface BlockchainContextType {
    service: BlockchainService | null;
    walletAddress: string;
    isConnected: boolean;
    isLoading: boolean;
    error: string | null;
    network: NetworkType;
    connectWallet: () => Promise<boolean>;
    switchNetwork: (network: NetworkType) => Promise<boolean>;
    
    // CopilotKit-friendly action methods
    registerAgent: (agent: { id: string; name: string; provider: string; version: string }, useEIP712?: boolean) => Promise<BlockchainActionResult<{ fingerprintHash: string; transactionHash?: string }>>;
    verifyAgent: (fingerprintHash: string) => Promise<BlockchainActionResult<Agent>>;
    revokeAgent: (fingerprintHash: string) => Promise<BlockchainActionResult<{ transactionHash: string }>>;
    generateFingerprint: (agent: { id: string; name: string; provider: string; version: string }) => Promise<BlockchainActionResult<{ fingerprintHash: string }>>;
    
    // Additional utility methods for agents
    getNetworkInfo: () => { name: string; chainId: number; contractAddress: string };
    isWalletReady: () => boolean;
    getConnectionStatus: () => { connected: boolean; address: string; network: string; loading: boolean; error: string | null };
}

// Create the context with a default value
const BlockchainContext = createContext<BlockchainContextType | undefined>(undefined);

// Define available networks
const NETWORKS: Record<NetworkType, BlockchainConfig> = {
    sepolia: {
        networkUrl: 'https://eth-sepolia.g.alchemy.com/v2/IvAVoFEopb0S6TxdGeSxv7pfWEn6rmee',
        chainId: 11155111,
        contractAddress: '0x92eF65Ba802b38F3A87a3Ae292a4624FA3040930',
        name: 'Sepolia Testnet'
    },
    goerli: {
        networkUrl: '',
        chainId: 0,
        contractAddress: '',
        name: ''
    },
    mainnet: {
        networkUrl: '',
        chainId: 0,
        contractAddress: '',
        name: ''
    },
    arbitrum: {
        networkUrl: '',
        chainId: 0,
        contractAddress: '',
        name: ''
    },
    polygon: {
        networkUrl: '',
        chainId: 0,
        contractAddress: '',
        name: ''
    }
};

// Create the provider component
export const BlockchainProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Initialize state 
    const [service, setService] = useState<BlockchainService | null>(null);
    const [walletAddress, setWalletAddress] = useState<string>('');
    const [isConnected, setIsConnected] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [network, setNetwork] = useState<NetworkType>('sepolia');

    // Initialize the blockchain service when the component mounts
    // or when the network changes
    useEffect(() => {
        const initService = () => {
            try {
                // Get the network configuration
                const networkConfig = NETWORKS[network];

                // Create a new blockchain service instance
                const newService = new BlockchainService(networkConfig);

                // Update state with the new service
                setService(newService);
                setError(null);
            } catch (err) {
                setError('Failed to initialize blockchain service: ' +
                    (err instanceof Error ? err.message : String(err)));
                setService(null);
            }
        };

        initService();
    }, [network]);

    // Implement wallet connection
    const connectWallet = async (): Promise<boolean> => {
        if (!service) return false;

        setIsLoading(true);
        setError(null);

        try {
            console.log('Connecting to wallet from context...');
            const address = await service.connectWallet();
            console.log('Wallet connection result:', address);

            if (address) {
                setWalletAddress(address);
                setIsConnected(true);
                return true;
            } else {
                setError('Failed to connect wallet. Please check that you have MetaMask installed and are on the correct network.');
                return false;
            }
        } catch (err) {
            console.error('Context wallet connection error:', err);
            
            // Special handling for MetaMask connection in progress
            if (err instanceof Error && err.message.includes('MetaMask connection already in progress')) {
                setError('MetaMask connection already in progress. Please check the MetaMask extension and approve the connection.');
            } else {
                setError('Error connecting wallet: ' +
                    (err instanceof Error ? err.message : String(err)));
            }
            return false;
        } finally {
            console.log('Wallet connection attempt completed, setting isLoading to false');
            setIsLoading(false);
        }
    };

    // Implement network switching
    const switchNetwork = async (newNetwork: NetworkType): Promise<boolean> => {
        if (newNetwork === network) return true;

        setIsLoading(true);
        setError(null);

        try {
            // Update the network
            setNetwork(newNetwork);

            // If connected, reconnect to the new network
            if (isConnected) {
                const reconnected = await connectWallet();
                return reconnected;
            }

            return true;
        } catch (err) {
            setError('Error switching network: ' +
                (err instanceof Error ? err.message : String(err)));
            return false;
        } finally {
            setIsLoading(false);
        }
    };

    // CopilotKit-friendly action methods
    const registerAgent = async (
        agent: { id: string; name: string; provider: string; version: string }, 
        useEIP712: boolean = false
    ): Promise<BlockchainActionResult<{ fingerprintHash: string; transactionHash?: string }>> => {
        if (!service || !isConnected) {
            return {
                success: false,
                error: 'Blockchain service not available or wallet not connected',
                details: !service ? 'Service not initialized' : 'Wallet not connected'
            };
        }

        try {
            // Generate fingerprint hash
            const fingerprintHash = service.generateFingerprintHash(agent);
            
            // Create full agent object for registration
            const fullAgent: Omit<Agent, 'createdAt'> = {
                ...agent,
                fingerprintHash
            };

            // Register on blockchain
            const result = await service.registerFingerprint(fullAgent, useEIP712);
            
            if (result.success) {
                return {
                    success: true,
                    data: { 
                        fingerprintHash,
                        transactionHash: result.transactionHash
                    },
                    details: `Agent ${agent.name} successfully registered with fingerprint ${fingerprintHash}`
                };
            } else {
                return {
                    success: false,
                    error: result.error || 'Registration failed',
                    details: 'Blockchain transaction was not successful'
                };
            }
        } catch (err) {
            return {
                success: false,
                error: 'Registration error',
                details: err instanceof Error ? err.message : String(err)
            };
        }
    };

    const verifyAgent = async (fingerprintHash: string): Promise<BlockchainActionResult<Agent>> => {
        if (!service) {
            return {
                success: false,
                error: 'Blockchain service not available',
                details: 'Service not initialized'
            };
        }

        try {
            const agent = await service.verifyFingerprint(fingerprintHash);
            
            if (agent) {
                return {
                    success: true,
                    data: agent,
                    details: `Agent verified: ${agent.name} (${agent.id}) from ${agent.provider}`
                };
            } else {
                return {
                    success: false,
                    error: 'Verification failed',
                    details: 'Fingerprint not found or invalid'
                };
            }
        } catch (err) {
            return {
                success: false,
                error: 'Verification error',
                details: err instanceof Error ? err.message : String(err)
            };
        }
    };

    const revokeAgent = async (fingerprintHash: string): Promise<BlockchainActionResult<{ transactionHash: string }>> => {
        if (!service || !isConnected) {
            return {
                success: false,
                error: 'Blockchain service not available or wallet not connected',
                details: !service ? 'Service not initialized' : 'Wallet not connected'
            };
        }

        try {
            const result = await service.revokeFingerprint(fingerprintHash);
            
            if (result.success) {
                return {
                    success: true,
                    data: { transactionHash: result.transactionHash || 'Transaction completed' },
                    details: `Fingerprint ${fingerprintHash} successfully revoked`
                };
            } else {
                return {
                    success: false,
                    error: result.error || 'Revocation failed',
                    details: 'Blockchain transaction was not successful'
                };
            }
        } catch (err) {
            return {
                success: false,
                error: 'Revocation error',
                details: err instanceof Error ? err.message : String(err)
            };
        }
    };

    const generateFingerprint = async (
        agent: { id: string; name: string; provider: string; version: string }
    ): Promise<BlockchainActionResult<{ fingerprintHash: string }>> => {
        if (!service) {
            return {
                success: false,
                error: 'Blockchain service not available',
                details: 'Service not initialized'
            };
        }

        try {
            const fingerprintHash = service.generateFingerprintHash(agent);
            return {
                success: true,
                data: { fingerprintHash },
                details: `Generated fingerprint for ${agent.name}: ${fingerprintHash}`
            };
        } catch (err) {
            return {
                success: false,
                error: 'Fingerprint generation error',
                details: err instanceof Error ? err.message : String(err)
            };
        }
    };

    // Utility methods
    const getNetworkInfo = () => {
        const networkConfig = NETWORKS[network];
        return {
            name: networkConfig.name,
            chainId: networkConfig.chainId,
            contractAddress: networkConfig.contractAddress
        };
    };

    const isWalletReady = () => {
        return !!(service && isConnected && walletAddress);
    };

    const getConnectionStatus = () => {
        return {
            connected: isConnected,
            address: walletAddress,
            network: NETWORKS[network].name,
            loading: isLoading,
            error
        };
    };

    // Create the context value
    const contextValue: BlockchainContextType = {
        service,
        walletAddress,
        isConnected,
        isLoading,
        error,
        network,
        connectWallet,
        switchNetwork,
        registerAgent,
        verifyAgent,
        revokeAgent,
        generateFingerprint,
        getNetworkInfo,
        isWalletReady,
        getConnectionStatus
    };

    // Return the provider with the context value
    return (
        <BlockchainContext.Provider value={contextValue}>
            {children}
        </BlockchainContext.Provider>
    );
};

// Create a custom hook for easy context usage
export const useBlockchain = () => {
    const context = useContext(BlockchainContext);
    if (context === undefined) {
        throw new Error('useBlockchain must be used within a BlockchainProvider');
    }
    return context;
};

// src/contexts/BlockchainContext.ts
import React, { createContext, useState, useContext, useEffect } from 'react';
import { BlockchainService } from '../services/blockchain.service';
import { BlockchainConfig, NetworkType } from '../types';

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
    // Add more functions as needed
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

    // Create the context value
    const contextValue: BlockchainContextType = {
        service,
        walletAddress,
        isConnected,
        isLoading,
        error,
        network,
        connectWallet,
        switchNetwork
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

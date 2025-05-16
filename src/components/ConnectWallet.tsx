import React, { useState } from 'react';
import { useBlockchain } from '../contexts/BlockchainContext';

const ConnectWallet: React.FC = () => {
    const { connectWallet, isLoading, error: contextError } = useBlockchain();
    const [error, setError] = useState<string | null>(null);

    const handleConnect = async () => {
        try {
            setError(null);

            // Check if MetaMask is installed
            if (!window.ethereum) {
                setError('MetaMask not detected. Please install MetaMask extension to connect your wallet.');
                return;
            }

            const success = await connectWallet();
            if (!success) {
                // This error is shown when connectWallet returns false but doesn't throw an error
                setError('Failed to connect wallet. Make sure you are using Sepolia testnet in MetaMask.')
            }
        } catch (err) {
            // Special handling for "Already processing" MetaMask error
            if (err instanceof Error && err.message.includes('MetaMask connection already in progress')) {
                setError('MetaMask connection already in progress. Please open MetaMask and approve the connection request.');
            } else {
                // If a specific error was thrown, display it
                setError('Error connecting wallet: ' + (err instanceof Error ? err.message : String(err)));
            }
        }
    };

    return (
        <div className="connect-wallet">
            <button
                onClick={handleConnect}
                disabled={isLoading}
                className="connect-button"
            >
                {isLoading ? 'Connecting...' : 'Connect Wallet'}
            </button>

            {(error || contextError) && <p className="error-message">{error || contextError}</p>}
        </div>
    );
};

export default ConnectWallet;

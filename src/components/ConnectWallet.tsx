import React, { useState } from 'react';
import { BlockchainService } from '../services/blockchain.service';

interface ConnectWalletProps {
  blockchainService: BlockchainService;
  onConnect: (address: string) => void;
}

const ConnectWallet: React.FC<ConnectWalletProps> = ({ blockchainService, onConnect }) => {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    try {
      setConnecting(true);
      setError(null);
      
      // Check if MetaMask is installed
      if (!window.ethereum) {
        setError('MetaMask not detected. Please install MetaMask extension to connect your wallet.');
        return;
      }
      
      const address = await blockchainService.connectWallet();
      
      if (address) {
        onConnect(address);
      } else {
        // This error is shown when connectWallet returns null but doesn't throw an error
        setError('Failed to connect wallet. Make sure you are using Sepolia testnet in MetaMask.');
      }
    } catch (err) {
      // Special handling for "Already processing" MetaMask error
      if (err instanceof Error && err.message.includes('MetaMask connection already in progress')) {
        setError('MetaMask connection already in progress. Please open MetaMask and approve the connection request.');
      } else {
        // If a specific error was thrown, display it
        setError('Error connecting wallet: ' + (err instanceof Error ? err.message : String(err)));
      }
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="connect-wallet">
      <button 
        onClick={handleConnect} 
        disabled={connecting}
        className="connect-button"
      >
        {connecting ? 'Connecting...' : 'Connect Wallet'}
      </button>
      
      {error && <p className="error-message">{error}</p>}
    </div>
  );
};

export default ConnectWallet;
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
      
      const address = await blockchainService.connectWallet();
      
      if (address) {
        onConnect(address);
      } else {
        setError('Failed to connect wallet');
      }
    } catch (err) {
      setError('Error connecting wallet: ' + (err instanceof Error ? err.message : String(err)));
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
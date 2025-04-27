import React, { useState } from 'react';
import './styles.css';
import ConnectWallet from './components/ConnectWallet';
import FingerprintForm from './components/FingerprintForm';
import VerifyFingerprint from './components/VerifyFingerprint';
import { BlockchainService } from './services/blockchain.service';
import { BlockchainConfig, Agent } from './types';

// Blockchain configuration - comes from environment variables or defaults to placeholder values
// In production, these values should be set in environment variables
const blockchainConfig: BlockchainConfig = {
  // For development use Sepolia testnet
  networkUrl: 'https://eth-sepolia.g.alchemy.com/v2/your-api-key', 
  chainId: 11155111, // Sepolia testnet
  // Deployed contract address on Sepolia
  contractAddress: '0x0000000000000000000000000000000000000000' // Replace with your contract address
};

const App: React.FC = () => {
  const [walletConnected, setWalletConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [activeTab, setActiveTab] = useState<'register' | 'verify'>('register');
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [registeredAgent, setRegisteredAgent] = useState<Omit<Agent, 'createdAt'> | null>(null);

  // Initialize blockchain service
  const blockchainService = new BlockchainService(blockchainConfig);

  const handleWalletConnect = (address: string) => {
    setWalletConnected(true);
    setWalletAddress(address);
  };

  const handleRegistrationSuccess = (agent: Omit<Agent, 'createdAt'>) => {
    setRegistrationSuccess(true);
    setRegisteredAgent(agent);
  };

  return (
    <div className="app-container">
      <header>
        <h1>AI Agent Fingerprinting System</h1>
        <p>Secure verification of AI agents using blockchain technology</p>
      </header>

      <main>
        {!walletConnected ? (
          <section className="connect-section">
            <h2>Connect Your Wallet</h2>
            <p>Connect your Ethereum wallet to register or verify AI agent fingerprints</p>
            <ConnectWallet 
              blockchainService={blockchainService} 
              onConnect={handleWalletConnect} 
            />
          </section>
        ) : (
          <>
            <div className="wallet-info">
              <p>Connected Wallet: {walletAddress.substring(0, 6)}...{walletAddress.substring(walletAddress.length - 4)}</p>
            </div>

            <div className="tabs">
              <button 
                className={`tab ${activeTab === 'register' ? 'active' : ''}`}
                onClick={() => setActiveTab('register')}
              >
                Register Fingerprint
              </button>
              <button 
                className={`tab ${activeTab === 'verify' ? 'active' : ''}`}
                onClick={() => setActiveTab('verify')}
              >
                Verify Fingerprint
              </button>
            </div>

            <div className="tab-content">
              {activeTab === 'register' && (
                <>
                  {registrationSuccess ? (
                    <div className="success-card">
                      <h2>Registration Successful!</h2>
                      <p>AI Agent fingerprint has been registered on the blockchain.</p>
                      {registeredAgent && (
                        <div className="agent-details">
                          <p><strong>Agent ID:</strong> {registeredAgent.id}</p>
                          <p><strong>Name:</strong> {registeredAgent.name}</p>
                          <p><strong>Fingerprint Hash:</strong> {registeredAgent.fingerprintHash}</p>
                        </div>
                      )}
                      <button onClick={() => {
                        setRegistrationSuccess(false);
                        setRegisteredAgent(null);
                      }}>Register Another</button>
                    </div>
                  ) : (
                    <FingerprintForm 
                      blockchainService={blockchainService}
                      onSuccess={handleRegistrationSuccess}
                    />
                  )}
                </>
              )}

              {activeTab === 'verify' && (
                <VerifyFingerprint blockchainService={blockchainService} />
              )}
            </div>
          </>
        )}
      </main>

      <footer>
        <p>&copy; 2025 AI Agent Fingerprinting System</p>
      </footer>
    </div>
  );
};

export default App;
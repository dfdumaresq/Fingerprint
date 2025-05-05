import React, { useState } from 'react';
import './styles.css';
import ConnectWallet from './components/ConnectWallet';
import FingerprintForm from './components/FingerprintForm';
import VerifyFingerprint from './components/VerifyFingerprint';
import { BlockchainService } from './services/blockchain.service';
import { BlockchainConfig, Agent } from './types';

// Blockchain configuration - would typically come from environment variables
const blockchainConfig: BlockchainConfig = {
  // For development use Sepolia testnet
  networkUrl: 'https://eth-sepolia.g.alchemy.com/v2/HFnhVrrSQ3ZuUoP7csCxDfSIvJ2Cm9GE', 
  chainId: 11155111, // Sepolia testnet
  // Deployed contract address on Sepolia
  contractAddress: '0x92eF65Ba802b38F3A87a3Ae292a4624FA3040930'
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
            <div className="connection-instructions">
              <p><strong>Requirements:</strong></p>
              <ol>
                <li>MetaMask wallet extension installed</li>
                <li>Wallet connected to <strong>Sepolia testnet</strong> (Chain ID: 11155111)</li>
              </ol>
              <p><small>Need Sepolia ETH? Get it from <a href="https://sepoliafaucet.com/" target="_blank" rel="noopener noreferrer">Sepolia Faucet</a></small></p>
            </div>
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
        <div className="assistant-fingerprint">
          <div className="fingerprint-icon">🧠</div>
          <div className="fingerprint-info">
            <p><small>This system was built with assistance from:</small></p>
            <p><strong>ID:</strong> AI Agent Fingerprinting System Code Assistant</p>
            <p><strong>AI:</strong> Claude (Anthropic)</p>
            <p><strong>Version:</strong> Claude-3-7-Sonnet-20250219</p>
            <p><strong>Fingerprint Hash:</strong> <span className="hash">0xbe7a118875bb8f33a2a58b78d74a1cfd6bb35ac3fe856c8b6c528daf4c1e888d</span></p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;

import React, { useState } from 'react';
import './styles.css';
import ConnectWallet from './components/ConnectWallet';
import FingerprintForm from './components/FingerprintForm';
import VerifyFingerprint from './components/VerifyFingerprint';
import RevokeFingerprint from './components/RevokeFingerprint';
import CopilotKitActions from './components/CopilotKitActions';
import { Agent } from './types';
import { BlockchainProvider, useBlockchain } from './contexts/BlockchainContext';
import { CopilotKit } from '@copilotkit/react-core';
import { CopilotChat } from '@copilotkit/react-ui';

// Main App wrapper to provide the BlockchainProvider and CopilotKit context
const AppWrapper: React.FC = () => {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <BlockchainProvider>
        <CopilotKitActions />
        <AppContent />
      </BlockchainProvider>
    </CopilotKit>
  );
};

// Actual App content that uses the BlockchainContext
const AppContent: React.FC = () => {
  // Get blockchain context
  const { walletAddress, isConnected, service } = useBlockchain();
  
  const [activeTab, setActiveTab] = useState<'register' | 'verify' | 'revoke' | 'ai-assistant'>('register');
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [registeredAgent, setRegisteredAgent] = useState<Omit<Agent, 'createdAt'> | null>(null);

  const handleRegistrationSuccess = (agent: Omit<Agent, 'createdAt'>) => {
    setRegistrationSuccess(true);
    setRegisteredAgent(agent);
  };

  const handleRevocationSuccess = () => {
    // You could add specific handling for revocation success if needed
    console.log('Fingerprint successfully revoked');
  };

  return (
    <div className="app-container">
      <header>
        <h1>AI Agent Fingerprinting System</h1>
        <p>Secure verification of AI agents using blockchain technology</p>
      </header>

      <main>
        {!isConnected ? (
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
            <ConnectWallet/>
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
              <button
                className={`tab ${activeTab === 'revoke' ? 'active' : ''}`}
                onClick={() => setActiveTab('revoke')}
              >
                Revoke Fingerprint
              </button>
              <button
                className={`tab ${activeTab === 'ai-assistant' ? 'active' : ''}`}
                onClick={() => setActiveTab('ai-assistant')}
              >
                🤖 AI Assistant
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
                    <FingerprintForm onSuccess={handleRegistrationSuccess} />
                  )}
                </>
              )}

              {activeTab === 'verify' && (
                <VerifyFingerprint blockchainService={service!} />
              )}

              {activeTab === 'revoke' && (
                <RevokeFingerprint
                  blockchainService={service!}
                  onSuccess={handleRevocationSuccess}
                />
              )}

              {activeTab === 'ai-assistant' && (
                <div className="ai-assistant-tab">
                  <h2>🤖 AI Assistant for Blockchain Operations</h2>
                  <div className="ai-assistant-info">
                    <p>
                      <strong>Your AI-powered blockchain assistant is ready!</strong> 
                      You can use natural language to interact with the fingerprinting system.
                    </p>
                    <div className="ai-capabilities">
                      <h3>✨ What I can help you with:</h3>
                      <ul>
                        <li><strong>Register agents:</strong> "Register a new agent called GPT-4 from OpenAI"</li>
                        <li><strong>Verify fingerprints:</strong> "Check if this fingerprint is valid: 0x123..."</li>
                        <li><strong>Generate fingerprints:</strong> "Generate a fingerprint for Claude-3 from Anthropic"</li>
                        <li><strong>Revoke fingerprints:</strong> "Revoke this agent fingerprint: 0x456..."</li>
                        <li><strong>Check status:</strong> "What's my wallet status?" or "Show blockchain info"</li>
                        <li><strong>Connect wallet:</strong> "Help me connect my MetaMask wallet"</li>
                      </ul>
                    </div>
                    {!isConnected && (
                      <div className="ai-wallet-notice">
                        <p>💡 <strong>Note:</strong> Connect your wallet first to enable agent registration and revocation through the AI assistant.</p>
                      </div>
                    )}
                  </div>
                  <div className="ai-chat-container">
                    <CopilotChat
                      instructions="You are an AI assistant for the Blockchain AI Agent Fingerprinting System. Help users register, verify, and manage AI agent fingerprints on the blockchain. Always provide clear explanations about blockchain transactions and agent verification. Use the available actions to perform blockchain operations when requested."
                    />
                  </div>
                </div>
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
            <p><strong>Fingerprint Hash:</strong> <span className="hash">0x59bba0ed5a7d4a5ba2c3ecad48fa376f9383b834ad28b581a5ea97e11f3d1385</span></p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default AppWrapper;

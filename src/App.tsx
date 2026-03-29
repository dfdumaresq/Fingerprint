import React, { useState } from 'react';
import './styles.css';
import ConnectWallet from './components/ConnectWallet';
import FingerprintForm from './components/FingerprintForm';
import VerifyFingerprint from './components/VerifyFingerprint';
import RevokeFingerprint from './components/RevokeFingerprint';
import { BehavioralRegistration } from './components/BehavioralRegistration';
import { BehavioralVerification } from './components/BehavioralVerification';
import { MedicalAuditDashboard } from './components/MedicalAuditDashboard';
import { TriageDashboard } from './components/TriageDashboard';
import { Agent } from './types';
import { BlockchainProvider, useBlockchain } from './contexts/BlockchainContext';

// Main App wrapper to provide the BlockchainProvider context
const AppWrapper: React.FC = () => {
  return (
    <BlockchainProvider>
      <AppContent />
    </BlockchainProvider>
  );
};

// Actual App content that uses the BlockchainContext
const AppContent: React.FC = () => {
  // Get blockchain context
    const { walletAddress, isConnected, isSandbox, service } = useBlockchain();
  
    const [activeTab, setActiveTab] = useState<'register' | 'verify' | 'revoke' | 'behavior-register' | 'behavior-verify' | 'medical-audit' | 'triage'>(() => {
        const hash = window.location.hash.replace('#', '');
        if (['register', 'verify', 'revoke', 'behavior-register', 'behavior-verify', 'medical-audit', 'triage'].includes(hash)) {
            return hash as any;
        }
        return 'triage'; // Default to the Clinician Triage front-end!
    });

    React.useEffect(() => {
        const handleHashChange = () => {
            const hash = window.location.hash.replace('#', '');
            if (['register', 'verify', 'revoke', 'behavior-register', 'behavior-verify', 'medical-audit', 'triage'].includes(hash)) {
                setActiveTab(hash as any);
            }
        };
        window.addEventListener('hashchange', handleHashChange);
        return () => window.removeEventListener('hashchange', handleHashChange);
    }, []);

    const handleTabChange = (tab: 'register' | 'verify' | 'revoke' | 'behavior-register' | 'behavior-verify' | 'medical-audit' | 'triage') => {
        setActiveTab(tab);
        window.location.hash = tab;
    };
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [registeredAgent, setRegisteredAgent] = useState<Omit<Agent, 'createdAt'> | null>(null);
  const [fingerprintHashForBehavior, setFingerprintHashForBehavior] = useState<string>('');
    const [inputHash, setInputHash] = useState<string>('');

  const handleRegistrationSuccess = (agent: Omit<Agent, 'createdAt'>) => {
    setRegistrationSuccess(true);
    setRegisteredAgent(agent);
      // Pre-fill hashes for subsequent tabs to ensure flow continuity
      setInputHash(agent.fingerprintHash);
      setFingerprintHashForBehavior(agent.fingerprintHash);
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
                          <p><small>Or use <strong>Sandbox Mode</strong> for a quick preview without a wallet.</small></p>
              <p><small>Need Sepolia ETH? Get it from <a href="https://sepoliafaucet.com/" target="_blank" rel="noopener noreferrer">Sepolia Faucet</a></small></p>
            </div>
            <ConnectWallet/>
          </section>
        ) : (
          <>
            <div className="wallet-info">
              <p>Connected Wallet: {walletAddress.substring(0, 6)}...{walletAddress.substring(walletAddress.length - 4)}</p>
                              {isSandbox && <span className="sandbox-badge">Sandbox Mode Active</span>}
            </div>

            <div className="tabs">
              <button
                className={`tab ${activeTab === 'triage' ? 'active' : ''}`}
                onClick={() => handleTabChange('triage')}
                title="View the Clinician Triage Queue"
              >
                Clinician Triage
              </button>
              <button
                className={`tab ${activeTab === 'medical-audit' ? 'active' : ''}`}
                onClick={() => handleTabChange('medical-audit')}
                title="View the Immutable Clinical Agent Audit Ledger"
              >
                Audit & Integrity
              </button>
              <button
                className={`tab ${activeTab === 'register' ? 'active' : ''}`}
                                  onClick={() => handleTabChange('register')}
                title="Register a new AI agent fingerprint on the blockchain"
              >
                Register Fingerprint
              </button>
              <button
                className={`tab ${activeTab === 'verify' ? 'active' : ''}`}
                                  onClick={() => handleTabChange('verify')}
                title="Verify an existing fingerprint against blockchain records"
              >
                Verify Fingerprint
              </button>
              <button
                className={`tab ${activeTab === 'revoke' ? 'active' : ''}`}
                                  onClick={() => handleTabChange('revoke')}
                title="Revoke a fingerprint you previously registered"
              >
                Revoke Fingerprint
              </button>
              <button
                className={`tab ${activeTab === 'behavior-register' ? 'active' : ''}`}
                                  onClick={() => handleTabChange('behavior-register')}
                title="Register behavioral traits for an AI agent to detect future model changes"
              >
                Register Behavioral Trait
              </button>
              <button
                className={`tab ${activeTab === 'behavior-verify' ? 'active' : ''}`}
                                  onClick={() => handleTabChange('behavior-verify')}
                title="Verify behavioral traits to detect model drift or substitution"
              >
                Verify Behavioral Trait
              </button>
            </div>

            <div className="tab-content">
                              <div style={{ display: activeTab === 'triage' ? 'block' : 'none' }}>
                                <TriageDashboard />
                              </div>

                              <div style={{ display: activeTab === 'medical-audit' ? 'block' : 'none' }}>
                                <MedicalAuditDashboard />
                              </div>

                              <div style={{ display: activeTab === 'register' ? 'block' : 'none' }}>
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
                              </div>

                              <div style={{ display: activeTab === 'verify' ? 'block' : 'none' }}>
                <VerifyFingerprint blockchainService={service!} />
                              </div>

                              <div style={{ display: activeTab === 'revoke' ? 'block' : 'none' }}>
                <RevokeFingerprint
                  blockchainService={service!}
                  onSuccess={handleRevocationSuccess}
                />
                              </div>

                              <div style={{ display: activeTab === 'behavior-register' ? 'block' : 'none' }}>
                  {!fingerprintHashForBehavior ? (
                    <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '5px' }}>
                      <h3>Register Behavioral Trait</h3>
                      <p>Enter the fingerprint hash for which you want to register behavioral traits:</p>
                      <input
                        type="text"
                        placeholder="0x..."
                                              value={inputHash}
                                              onChange={(e) => setInputHash(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '10px',
                          fontSize: '14px',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          marginBottom: '10px'
                        }}
                      />
                      <button
                        onClick={() => {
                                                  if (inputHash.trim()) {
                                                      setFingerprintHashForBehavior(inputHash.trim());
                          }
                        }}
                                              disabled={!inputHash.trim()}
                        style={{ padding: '10px 20px' }}
                      >
                        Continue to Registration
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                                                  onClick={() => {
                                                      setFingerprintHashForBehavior('');
                                                      setInputHash('');
                                                  }}
                        style={{ marginBottom: '15px', padding: '8px 16px' }}
                      >
                        ← Change Fingerprint Hash
                      </button>
                      <BehavioralRegistration fingerprintHash={fingerprintHashForBehavior} />
                    </>
                  )}
                              </div>

                              <div style={{ display: activeTab === 'behavior-verify' ? 'block' : 'none' }}>
                  {!fingerprintHashForBehavior ? (
                    <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '5px' }}>
                      <h3>Verify Behavioral Trait</h3>
                      <p>Enter the fingerprint hash for which you want to verify behavioral traits:</p>
                      <input
                        type="text"
                        placeholder="0x..."
                                              value={inputHash}
                                              onChange={(e) => setInputHash(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '10px',
                          fontSize: '14px',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          marginBottom: '10px'
                        }}
                      />
                      <button
                        onClick={() => {
                                                  if (inputHash.trim()) {
                                                      setFingerprintHashForBehavior(inputHash.trim());
                          }
                        }}
                                              disabled={!inputHash.trim()}
                        style={{ padding: '10px 20px' }}
                      >
                        Continue to Verification
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                                                  onClick={() => {
                                                      setFingerprintHashForBehavior('');
                                                      setInputHash('');
                                                  }}
                        style={{ marginBottom: '15px', padding: '8px 16px' }}
                      >
                        ← Change Fingerprint Hash
                      </button>
                      <BehavioralVerification fingerprintHash={fingerprintHashForBehavior} />
                    </>
                  )}
                              </div>
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

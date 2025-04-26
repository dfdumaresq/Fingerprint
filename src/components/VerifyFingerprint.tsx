import React, { useState } from 'react';
import { BlockchainService } from '../services/blockchain.service';
import { Agent } from '../types';
import { isValidFingerprintFormat, formatTimestamp } from '../utils/fingerprint.utils';

interface VerifyFingerprintProps {
  blockchainService: BlockchainService;
}

const VerifyFingerprint: React.FC<VerifyFingerprintProps> = ({ blockchainService }) => {
  const [fingerprintHash, setFingerprintHash] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<{ verified: boolean; agent: Agent | null }>({
    verified: false,
    agent: null
  });
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFingerprintHash(e.target.value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!fingerprintHash.trim()) {
      setError('Fingerprint hash is required');
      return;
    }
    
    // Validate fingerprint hash format
    if (!isValidFingerprintFormat(fingerprintHash)) {
      setError('Please enter a valid fingerprint hash (0x followed by 64 hex characters)');
      return;
    }
    
    setVerifying(true);
    setError(null);
    setResult({ verified: false, agent: null });
    
    try {
      const agent = await blockchainService.verifyFingerprint(fingerprintHash);
      
      setResult({
        verified: agent !== null,
        agent
      });
    } catch (err) {
      setError('Error verifying fingerprint: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="verify-fingerprint">
      <h2>Verify AI Agent Fingerprint</h2>
      
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="fingerprintHash">Fingerprint Hash</label>
          <input 
            type="text" 
            id="fingerprintHash" 
            value={fingerprintHash} 
            onChange={handleChange} 
            disabled={verifying}
          />
        </div>
        
        <button type="submit" disabled={verifying}>
          {verifying ? 'Verifying...' : 'Verify Fingerprint'}
        </button>
      </form>
      
      {error && <p className="error-message">{error}</p>}
      
      {!error && result.agent && (
        <div className="result-card">
          <h3>Verification Successful</h3>
          <p><strong>Agent ID:</strong> {result.agent.id}</p>
          <p><strong>Name:</strong> {result.agent.name}</p>
          <p><strong>Provider:</strong> {result.agent.provider}</p>
          <p><strong>Version:</strong> {result.agent.version}</p>
          <p><strong>Created At:</strong> {formatTimestamp(result.agent.createdAt)}</p>
        </div>
      )}
      
      {!error && !result.agent && result.verified === false && verifying === false && fingerprintHash && (
        <div className="result-card error">
          <h3>Verification Failed</h3>
          <p>The provided fingerprint was not found on the blockchain.</p>
        </div>
      )}
    </div>
  );
};

export default VerifyFingerprint;
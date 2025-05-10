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
  const [verificationAttempted, setVerificationAttempted] = useState(false);
  const [result, setResult] = useState<{ verified: boolean; agent: Agent | null }>({
    verified: false,
    agent: null
  });
  const [error, setError] = useState<string | null>(null);

  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [isInputValid, setIsInputValid] = useState<boolean>(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFingerprintHash(value);

    // Reset verification attempted state when input changes
    setVerificationAttempted(false);

    // Only show validation after user has typed something meaningful
    if (value.length > 3) {
      const validation = validateFingerprint(value);
      setIsInputValid(validation.isValid);
      setValidationMessage(validation.isValid ? null : (validation.errorMessage || 'Invalid format'));
    } else {
      setValidationMessage(null);
      setIsInputValid(false);
    }
  };

  const validateFingerprint = (hash: string): { isValid: boolean; errorMessage: string } => {
    if (!hash.trim()) {
      return { isValid: false, errorMessage: 'Fingerprint hash is required' };
    }
    
    // Check for common errors
    if (hash.startsWith('Ox')) {
      return { 
        isValid: false, 
        errorMessage: 'Invalid prefix "Ox". Fingerprint must start with "0x" (zero, not letter O)' 
      };
    }
    
    if (!hash.startsWith('0x')) {
      return { 
        isValid: false, 
        errorMessage: 'Missing "0x" prefix. All fingerprint hashes must start with 0x' 
      };
    }
    
    if (hash.length !== 66) {
      return { 
        isValid: false, 
        errorMessage: `Incorrect fingerprint length (${hash.length} characters). Must be exactly 66 characters (0x + 64 hex characters)` 
      };
    }
    
    // Full pattern validation
    if (!isValidFingerprintFormat(hash)) {
      return { 
        isValid: false, 
        errorMessage: 'Invalid fingerprint format. Must be 0x followed by 64 hex characters (0-9, a-f)' 
      };
    }
    
    return { isValid: true, errorMessage: '' };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate fingerprint with detailed feedback
    const validation = validateFingerprint(fingerprintHash);
    if (!validation.isValid) {
      setError(validation.errorMessage);
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
      // Mark that verification has been attempted
      setVerificationAttempted(true);
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
            className={fingerprintHash.length > 3 ? (isInputValid ? 'valid-input' : 'invalid-input') : ''}
            placeholder="0x..."
          />
          {validationMessage && (
            <div className="validation-message">
              <span className="validation-icon">⚠️</span>
              {validationMessage}
            </div>
          )}
          <div className="input-help">
            Format: 0x followed by 64 hexadecimal characters (0-9, a-f)
          </div>
        </div>
        
        <button 
          type="submit" 
          disabled={verifying || (fingerprintHash.length > 0 && !isInputValid)}
        >
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
      
      {!error && !result.agent && result.verified === false && verifying === false && verificationAttempted && (
        <div className="result-card error">
          <h3>Verification Failed</h3>
          <p>The provided fingerprint was not found on the blockchain.</p>
        </div>
      )}
    </div>
  );
};

export default VerifyFingerprint;
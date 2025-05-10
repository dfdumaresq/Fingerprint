import React, { useState, useEffect } from 'react';
import { BlockchainService } from '../services/blockchain.service';
import { isValidFingerprintFormat } from '../utils/fingerprint.utils';

interface RevokeFingerprintProps {
  blockchainService: BlockchainService;
  onSuccess: () => void;
}

const RevokeFingerprint: React.FC<RevokeFingerprintProps> = ({ blockchainService, onSuccess }) => {
  const [fingerprintHash, setFingerprintHash] = useState('');
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);

  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [isInputValid, setIsInputValid] = useState<boolean>(false);
  const [isRevocationSupported, setIsRevocationSupported] = useState<boolean>(true);

  // Check if revocation is supported on component mount
  useEffect(() => {
    // Check if we're using the live contract that doesn't support revocation
    const liveContractWithoutRevocation = "0x92eF65Ba802b38F3A87a3Ae292a4624FA3040930";
    const isUsingLiveContract = blockchainService.contract.target === liveContractWithoutRevocation;

    // Check if the contract has the isRevoked method
    const hasIsRevokedMethod = typeof blockchainService.contract.isRevoked === 'function';

    // Contract must both NOT be the live contract and HAVE the isRevoked method
    const isSupported = !isUsingLiveContract && hasIsRevokedMethod;
    setIsRevocationSupported(isSupported);

    if (isUsingLiveContract) {
      setError("This is the production contract on Sepolia testnet which does not support revocation. This feature requires a contract upgrade.");
    } else if (!hasIsRevokedMethod) {
      setError("The current contract deployment does not support revocation. This feature requires a contract upgrade.");
    }
  }, [blockchainService]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFingerprintHash(value);
    
    // Reset states when input changes
    setError(null);
    setSuccess(false);

    // Only validate after some meaningful input
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
    
    // First check if the fingerprint exists and is not already revoked
    try {
      const agent = await blockchainService.verifyFingerprint(fingerprintHash);
      
      if (!agent) {
        setError('Fingerprint does not exist');
        return;
      }
      
      if (agent.revoked) {
        setError('Fingerprint has already been revoked');
        return;
      }
    } catch (err) {
      setError('Error checking fingerprint: ' + (err instanceof Error ? err.message : String(err)));
      return;
    }
    
    setRevoking(true);
    setError(null);
    
    try {
      const success = await blockchainService.revokeFingerprint(fingerprintHash);
      
      if (success) {
        setSuccess(true);
        onSuccess(); // Callback to parent component
      } else {
        setError('Failed to revoke fingerprint');
      }
    } catch (err) {
      setError('Error revoking fingerprint: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setRevoking(false);
    }
  };
  
  return (
    <div className="revoke-fingerprint">
      <h2>Revoke AI Agent Fingerprint</h2>

      {!isRevocationSupported ? (
        <div className="upgrade-required-card">
          <h3>Feature Not Available</h3>
          <p>The current contract deployment does not support revocation.</p>
          <p>This feature requires a contract upgrade to implement revocation functionality.</p>
        </div>
      ) : (
        <>
          <p className="revocation-warning">
            ⚠️ Warning: Revoking a fingerprint is permanent and cannot be undone.
            Only the original registrant of the fingerprint can revoke it.
          </p>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="fingerprintHash">Fingerprint Hash to Revoke</label>
              <input
                type="text"
                id="fingerprintHash"
                value={fingerprintHash}
                onChange={handleChange}
                disabled={revoking || success || !isRevocationSupported}
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
              disabled={revoking || success || !isRevocationSupported || (fingerprintHash.length > 0 && !isInputValid)}
              className="revoke-button"
            >
              {revoking ? 'Revoking...' : 'Revoke Fingerprint'}
            </button>
          </form>

          {error && <p className="error-message">{error}</p>}

          {success && (
            <div className="success-card">
              <h3>Fingerprint Successfully Revoked</h3>
              <p>The fingerprint has been permanently marked as revoked on the blockchain.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default RevokeFingerprint;
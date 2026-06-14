import React, { useState, useEffect } from 'react';
import { isValidFingerprintFormat } from '../utils/fingerprint.utils';
import { useBlockchain } from '../contexts/BlockchainContext';

const REACT_APP_API_URL = process.env.REACT_APP_API_URL || '';
const REACT_APP_API_KEY = process.env.REACT_APP_API_KEY || 'sk_test_123';

interface RevokeFingerprintProps {
  blockchainService?: any; 
  onSuccess: () => void;
  initialHash?: string;
}

const RevokeFingerprint: React.FC<RevokeFingerprintProps> = ({ blockchainService: propBlockchainService, onSuccess, initialHash = '' }) => {
  const { service: contextService } = useBlockchain();
  const service = propBlockchainService || contextService;
  
  const [fingerprintHash, setFingerprintHash] = useState(initialHash);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);
  const [isInputValid, setIsInputValid] = useState<boolean>(isValidFingerprintFormat(initialHash));
  const [isRevocationSupported, setIsRevocationSupported] = useState<boolean>(true);


  useEffect(() => {
    const checkRevocationSupport = async () => {
      try {
        if (!service) {
          setIsRevocationSupported(false);
          return;
        }
        const isSupported = await service.supportsRevocation();
        setIsRevocationSupported(isSupported);
        if (!isSupported) {
          setError("The current contract deployment does not support revocation.");
        }
      } catch (err) {
        setIsRevocationSupported(false);
        setError("Unable to determine revocation support.");
      }
    };
    checkRevocationSupport();
  }, [service]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFingerprintHash(value);
    setError(null);
    setSuccess(false);
    
    if (value.length > 3) {
      setIsInputValid(isValidFingerprintFormat(value));
    } else {
      setIsInputValid(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidFingerprintFormat(fingerprintHash)) {
      setError('Invalid fingerprint format.');
      return;
    }
    
    setRevoking(true);
    setError(null);
    
    try {
      if (!service) throw new Error('Blockchain service not available');
      
      const agent = await service.verifyFingerprint(fingerprintHash);
      if (!agent) {
        // Check if it's cached in the local DB
        const localDbCheck = await fetch(`${REACT_APP_API_URL}/v1/agents/${fingerprintHash}`, {
          headers: { 'Authorization': `Bearer ${REACT_APP_API_KEY}` }
        });
        if (localDbCheck.status === 200) {
          const dbAgent = await localDbCheck.json();
          if (dbAgent && dbAgent.fingerprintHash) {
            throw new Error(
              `Sync Error: Agent "${dbAgent.name}" exists in the local database but is not registered on the blockchain. You must register it on-chain first before it can be revoked.`
            );
          }
        }
        throw new Error('Fingerprint does not exist on the blockchain registry.');
      }
      if (agent.revoked) throw new Error('Fingerprint is already revoked');

      const ok = await service.revokeFingerprint(fingerprintHash);
      if (ok) {
        setSuccess(true);
        onSuccess();
      } else {
        throw new Error('Revocation rejected or failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRevoking(false);
    }
  };
  
  return (
    <div className="revoke-fingerprint">
      <h3 style={{ marginBottom: '24px', fontSize: '1.2rem', fontWeight: 600 }}>Access Revocation</h3>

      {!isRevocationSupported ? (
        <div style={{ padding: '24px', background: 'rgba(239, 68, 68, 0.05)', borderRadius: '8px', border: '1px solid var(--plasma-border)' }}>
          <h4 className="text-error">Feature Restricted</h4>
          <p className="text-secondary" style={{ fontSize: '0.9rem' }}>The current blockchain anchor does not support identity revocation. A contract migration is required to enable this capability.</p>
        </div>
      ) : (
        <>
          <div style={{ padding: '16px', background: 'rgba(245, 158, 11, 0.05)', borderLeft: '3px solid var(--plasma-warning-amber)', marginBottom: '32px' }}>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--plasma-text-primary)', fontWeight: 600 }}>
              ⚠️ Administrative Action Required
            </p>
            <p className="text-secondary" style={{ margin: '8px 0 0 0', fontSize: '0.85rem', lineHeight: '1.6' }}>
              Revoking a fingerprint permanently invalidates the agent identity across all clinical workflows. This action is immutable and cannot be undone.
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="fingerprintHash">Fingerprint to Invalidate</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input
                  type="text"
                  id="fingerprintHash"
                  className="form-input tabular-nums"
                  value={fingerprintHash}
                  onChange={handleChange}
                  disabled={revoking || success}
                  placeholder="0x..."
                />
                <button
                  type="submit"
                  disabled={revoking || success || (fingerprintHash.length > 0 && !isInputValid)}
                  className="primary-btn"
                  style={{ background: 'var(--plasma-integrity-red)', whiteSpace: 'nowrap' }}
                >
                  {revoking ? 'Revoking...' : 'Revoke Identity'}
                </button>
              </div>
              <p className="text-secondary" style={{ fontSize: '0.85rem', marginTop: '8px' }}>
                Deterministic keccak256 hash of agent metadata.
              </p>
              <p className="text-secondary" style={{ fontSize: '0.85rem', marginTop: '8px' }}>
                Verification required: Only the original registrant or platform administrator may authorize revocation.
              </p>
            </div>
          </form>

          {error && <p className="text-error" style={{ marginTop: '16px', fontSize: '0.9rem' }}>{error}</p>}

          {success && (
            <div style={{ marginTop: '32px', textAlign: 'center', padding: '40px', background: 'rgba(16, 185, 129, 0.05)', borderRadius: '8px', border: '1px solid var(--plasma-border)' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>🛡️</div>
              <h4 style={{ color: 'var(--plasma-integrity-green)', marginBottom: '8px' }}>Identity Successfully Revoked</h4>
              <p className="text-secondary" style={{ fontSize: '0.9rem' }}>The agent fingerprint has been permanently marked as INVALID on the blockchain ledger.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default RevokeFingerprint;
import React, { useState } from 'react';
import { Agent } from '../types';
import { isValidFingerprintFormat, formatTimestamp, formatAddress } from '../utils/fingerprint.utils';
import { useBlockchain } from '../contexts/BlockchainContext';

interface VerifyFingerprintProps {
  blockchainService?: any; 
}

const VerifyFingerprint: React.FC<VerifyFingerprintProps> = ({ blockchainService: propBlockchainService }) => {
  const { service: contextService } = useBlockchain();
  const service = propBlockchainService || contextService;
  
  const [fingerprintHash, setFingerprintHash] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verificationAttempted, setVerificationAttempted] = useState(false);
  const [result, setResult] = useState<{
    verified: boolean;
    agent: Agent | null;
    signatureValid?: boolean;
    signerAddress?: string;
  }>({
    verified: false,
    agent: null
  });
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isInputValid, setIsInputValid] = useState<boolean>(false);
  const [traitHistory, setTraitHistory] = useState<any[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFingerprintHash(value);
    setVerificationAttempted(false);
    setTraitHistory(null);
    
    if (value.length > 3) {
      setIsInputValid(isValidFingerprintFormat(value));
    } else {
      setIsInputValid(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidFingerprintFormat(fingerprintHash)) {
      setError('Invalid fingerprint format. Must be 0x followed by 64 hex characters.');
      return;
    }

    setVerifying(true);
    setError(null);
    setResult({ verified: false, agent: null });
    setTraitHistory(null);

    try {
      if (!service) throw new Error("Blockchain service not available");
      const agent = await service.verifyFingerprint(fingerprintHash);

      if (agent) {
        let signatureValid = undefined;
        if (agent.signature && agent.signerAddress) {
          const recoveredAddress = service.verifyEIP712Signature(
            agent.signature,
            { id: agent.id, name: agent.name, provider: agent.provider, version: agent.version },
            agent.createdAt
          );
          signatureValid = recoveredAddress === agent.signerAddress;
        }
        setResult({ verified: true, agent, signatureValid, signerAddress: agent.signerAddress });

        if (agent.behavioralTraitHash) {
          setLoadingHistory(true);
          try {
            if (typeof service.getBehavioralTraitHistory === 'function') {
              const history = await service.getBehavioralTraitHistory(fingerprintHash);
              setTraitHistory(history);
            }
          } catch (hErr) {
            console.error("History fetch failed", hErr);
          } finally {
            setLoadingHistory(false);
          }
        }
      } else {
        setResult({ verified: false, agent: null });
      }
      setVerificationAttempted(true);
    } catch (err) {
      setError('Error verifying fingerprint: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setVerifying(false);
    }
  };

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div className="verify-fingerprint">
      <h3 style={{ marginBottom: '24px', fontSize: '1.2rem', fontWeight: 600 }}>Identity Verification</h3>
      
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="fingerprintHash">Target Fingerprint Hash</label>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input 
              type="text" 
              id="fingerprintHash" 
              className="form-input tabular-nums"
              value={fingerprintHash} 
              onChange={handleChange} 
              disabled={verifying}
              placeholder="0x..."
            />
            <button 
              type="submit" 
              className="primary-btn"
              disabled={verifying || (fingerprintHash.length > 0 && !isInputValid)}
            >
              {verifying ? 'Verifying...' : 'Search Ledger'}
            </button>
          </div>
              <p className="text-secondary" style={{ fontSize: '0.85rem', marginTop: '8px' }}>
                Verification required: Only the original registrant or platform administrator may authorize revocation.
              </p>
        </div>
      </form>
      
      {error && <p className="text-error" style={{ marginTop: '16px' }}>{error}</p>}
      
      {result.agent && (
        <div style={{ marginTop: '32px', borderTop: '1px solid var(--plasma-border)', paddingTop: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--plasma-integrity-green)' }}></div>
            <h4 style={{ margin: 0, fontSize: '1.1rem' }}>Record Authenticated</h4>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '24px' }}>
            <div>
              <label className="context-label">Agent Identity</label>
              <div style={{ fontWeight: 600 }}>{result.agent.name} (v{result.agent.version})</div>
            </div>
            <div>
              <label className="context-label">Operational ID</label>
              <div className="tabular-nums">{result.agent.id}</div>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label className="context-label">Blockchain Fingerprint</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <code style={{ fontSize: '0.85rem', color: 'var(--plasma-clinical-blue)', wordBreak: 'break-all' }}>{result.agent.fingerprintHash}</code>
                <button
                  onClick={() => handleCopy(result.agent!.fingerprintHash, 'fp')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}
                >
                  {copiedField === 'fp' ? '✓' : '📋'}
                </button>
              </div>
            </div>
            <div>
              <label className="context-label">Origin Provider</label>
              <div>{result.agent.provider}</div>
            </div>
            <div>
              <label className="context-label">Registration Timestamp</label>
              <div className="tabular-nums">{formatTimestamp(result.agent.createdAt)}</div>
            </div>
          </div>

          {result.agent.behavioralTraitHash && (
            <div style={{ marginTop: '32px', padding: '20px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--plasma-border)' }}>
              <label className="context-label">Behavioral Baseline</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <code style={{ fontSize: '0.85rem', opacity: 0.8 }}>{result.agent.behavioralTraitHash}</code>
                <button
                  onClick={() => handleCopy(result.agent!.behavioralTraitHash || '', 'trait')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}
                >
                  {copiedField === 'trait' ? '✓' : '📋'}
                </button>
              </div>
              {loadingHistory ? (
                <p className="text-muted" style={{ fontSize: '0.75rem' }}>Synchronizing history...</p>
              ) : traitHistory && traitHistory.length > 0 && (
                <div style={{ marginTop: '16px' }}>
                  <p className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', marginBottom: '8px' }}>History</p>
                  {traitHistory.slice(0, 3).map((h, i) => (
                    <div key={i} style={{ fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span className="text-secondary">{h.type === 'registered' ? 'Genesis' : 'Update'}</span>
                      <span className="tabular-nums opacity-70">{formatTimestamp(h.timestamp)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {result.agent.signature && (
            <div style={{ marginTop: '24px', padding: '16px', borderRadius: '4px', background: 'rgba(124, 58, 237, 0.05)', border: '1px solid var(--plasma-border)' }}>
               <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1rem' }}>{result.signatureValid ? '✅' : '❌'}</span>
                <label className="context-label" style={{ margin: 0 }}>EIP-712 Signature Validated</label>
              </div>
              <div style={{ fontSize: '0.85rem', marginTop: '8px' }}>
                <span className="text-secondary">Signer:</span>
                <code style={{ marginLeft: '8px', opacity: 0.8 }}>{formatAddress(result.signerAddress || '')}</code>
              </div>
            </div>
          )}

          <div style={{ marginTop: '24px', padding: '16px', borderRadius: '4px', background: result.agent.revoked ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)', border: '1px solid var(--plasma-border)' }}>
             <label className="context-label">Lifecycle Status</label>
             <div style={{ fontWeight: 700, color: result.agent.revoked ? 'var(--plasma-integrity-red)' : 'var(--plasma-integrity-green)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                {result.agent.revoked ? '⚠️ REVOKED' : '✓ ACTIVE'}
                {result.agent.revoked && result.agent.revokedAt && (
                   <span style={{ fontWeight: 400, fontSize: '0.8rem', opacity: 0.7 }} className="tabular-nums">
                     - {formatTimestamp(result.agent.revokedAt)}
                   </span>
                )}
             </div>
          </div>
        </div>
      )}
      
      {verificationAttempted && !result.agent && !verifying && (
        <div style={{ marginTop: '32px', textAlign: 'center', padding: '40px', background: 'rgba(239, 68, 68, 0.05)', borderRadius: '8px', border: '1px solid var(--plasma-border)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '16px' }}>❓</div>
          <h4 style={{ margin: '0 0 8px 0' }}>Record Not Found</h4>
          <p className="text-secondary" style={{ fontSize: '0.9rem' }}>The provided fingerprint hash does not exist on the current blockchain ledger.</p>
        </div>
      )}
    </div>
  );
};

export default VerifyFingerprint;

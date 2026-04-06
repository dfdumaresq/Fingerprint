import React, { useState, useEffect } from 'react';
import { useBlockchain } from '../contexts/BlockchainContext';
import { REASONING_TEST_SUITE_V1 } from '../tests/behavioralTestSuite';
import {
  createManualResponseSet,
  generateBehavioralTraitHash,
    BehavioralHashResult
} from '../utils/behavioral.utils';
import { Agent } from '../types';
import { C2PAService } from '../services/c2pa.service';
import { downloadC2PAManifest, getIdentityFilename } from '../utils/c2paExport.utils';

const c2paService = new C2PAService();

const REACT_APP_API_URL = process.env.REACT_APP_API_URL || '';
const REACT_APP_API_KEY = process.env.REACT_APP_API_KEY || '';

interface BehavioralRegistrationProps {
  fingerprintHash: string;
}

export const BehavioralRegistration: React.FC<BehavioralRegistrationProps> = ({ fingerprintHash }) => {
  const { service, isConnected } = useBlockchain();
  const [responses, setResponses] = useState<string[]>(
    new Array(REASONING_TEST_SUITE_V1.prompts.length).fill('')
  );
  const [currentStep, setCurrentStep] = useState(0);
  const [hashResult, setHashResult] = useState<BehavioralHashResult | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
    const [copiedField, setCopiedField] = useState<string | null>(null);

    const [existingTrait, setExistingTrait] = useState<{ hash: string; version: string } | null>(null);
    const [isLoadingTrait, setIsLoadingTrait] = useState(false);

    useEffect(() => {
        if (!service || !isConnected || !fingerprintHash) return;

        const checkExistingTrait = async () => {
            setIsLoadingTrait(true);
            try {
                const existingData = await service.contract.getBehavioralTraitData(fingerprintHash);
                const exists = existingData && existingData[0];
                if (exists) {
                    setExistingTrait({
                        hash: existingData[1],
                        version: existingData[2]
                    });
                } else {
                    setExistingTrait(null);
                }
            } catch (err) {
                console.error("Failed to check existing traits:", err);
            } finally {
                setIsLoadingTrait(false);
            }
        };

        checkExistingTrait();
    }, [service, isConnected, fingerprintHash]);

  const currentPrompt = REASONING_TEST_SUITE_V1.prompts[currentStep];
  const isLastPrompt = currentStep === REASONING_TEST_SUITE_V1.prompts.length - 1;
  const allResponsesComplete = responses.every(r => r.trim().length > 0);

  const handleResponseChange = (value: string) => {
    const newResponses = [...responses];
    newResponses[currentStep] = value;
    setResponses(newResponses);
  };

  const handleNext = () => {
    if (currentStep < REASONING_TEST_SUITE_V1.prompts.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleGenerateHash = () => {
    try {
      const responseSet = createManualResponseSet(REASONING_TEST_SUITE_V1, responses);
      const result = generateBehavioralTraitHash(responseSet);
      setHashResult(result);
      setError(null);
    } catch (err: any) {
      setError(`Failed to generate hash: ${err.message}`);
    }
  };

  const handleRegister = async () => {
    if (!service || !hashResult) return;

    setIsRegistering(true);
    setError(null);

    try {
        await c2paService.initializeIdentity(fingerprintHash);
        const result = await service.registerBehavioralTrait(
            fingerprintHash,
            hashResult.hash,
            hashResult.traitVersion
        );

        if (result.success) {
            setRegistrationSuccess(true);
            localStorage.setItem(`sidecar_${fingerprintHash}`, JSON.stringify(hashResult.responseSet));
            
            // Sync to off-chain verification cache (Redis)
            try {
                await fetch(`${REACT_APP_API_URL}/v1/internal/traits/seed`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${REACT_APP_API_KEY}`
                    },
                    body: JSON.stringify({
                        fingerprintHash,
                        responseSet: hashResult.responseSet
                    })
                });
            } catch (err) {
                console.warn("Failed to sync baseline to off-chain cache (Redis). Drift audits may be unavailable until synced.", err);
            }
        }
    } catch (err: any) {
        setError(`Registration failed: ${err.message}`);
    } finally {
        setIsRegistering(false);
    }
  };

    const handleDownloadIdentity = async () => {
        try {
            const agent: Omit<Agent, 'createdAt'> = {
                id: fingerprintHash,
                name: "Verified Agent",
                provider: "Identity Layer",
                version: hashResult?.traitVersion || "v1.0",
                fingerprintHash: fingerprintHash
            };

            const manifest = await c2paService.generateIdentityManifest(agent as any);
            downloadC2PAManifest(manifest, getIdentityFilename(fingerprintHash));
        } catch (err: any) {
            setError(`Failed to export identity: ${err.message}`);
        }
    };

    const copyToClipboard = (text: string, field: string) => {
        navigator.clipboard.writeText(text);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
    };

  if (!isConnected) {
    return (
      <div className="plasma-card" style={{ textAlign: 'center', padding: '40px' }}>
        <h3 className="text-error">Clinical Access Required</h3>
        <p className="text-secondary">Please connect your provider wallet to establish behavioral baselines.</p>
      </div>
    );
  }

  if (registrationSuccess) {
    return (
        <div className="plasma-card" style={{ border: '2px solid var(--plasma-integrity-green)' }}>
            <h3 style={{ color: 'var(--plasma-integrity-green)', marginBottom: '24px' }}>✅ Behavioral Baseline Established</h3>
            
            <div style={{ marginBottom: '24px', padding: '20px', background: 'var(--plasma-surface-2)', borderRadius: '8px', border: '1px solid var(--plasma-border)' }}>
                <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="text-muted" style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>Fingerprint</span>
                    <button onClick={() => copyToClipboard(fingerprintHash, 'fingerprint')} className="icon-btn">
                        {copiedField === 'fingerprint' ? '✓' : '📋'}
                    </button>
                </div>
                <code style={{ display: 'block', fontSize: '0.85rem', wordBreak: 'break-all', marginBottom: '20px', color: 'var(--plasma-text-secondary)' }}>{fingerprintHash}</code>
                
                <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="text-muted" style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>Trait Hash</span>
                    <button onClick={() => copyToClipboard(hashResult?.hash || '', 'trait')} className="icon-btn">
                        {copiedField === 'trait' ? '✓' : '📋'}
                    </button>
                </div>
                <code style={{ display: 'block', fontSize: '0.85rem', wordBreak: 'break-all', color: 'var(--plasma-text-secondary)' }}>{hashResult?.hash}</code>
            </div>

            <div style={{ display: 'flex', gap: '16px' }}>
                <button
                    onClick={handleDownloadIdentity}
                    className="primary-btn"
                    style={{ flex: 1, padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}
                >
                    <span>📥</span> Export Identity Manifest
                </button>
                <button
                    className="secondary-btn"
                    style={{ flex: 1, padding: '14px' }}
                    onClick={() => {
                        setRegistrationSuccess(false);
                        setHashResult(null);
                        setResponses(new Array(REASONING_TEST_SUITE_V1.prompts.length).fill(''));
                        setCurrentStep(0);
                    }}
                >
                    New Baseline
                </button>
            </div>
      </div>
    );
  }

  return (
    <div className="behavioral-audit-flow">
      <div style={{ marginBottom: '32px' }}>
        <h3 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--plasma-text-primary)', marginBottom: '8px' }}>
            Establish Behavioral Baseline
        </h3>
        <p className="text-secondary" style={{ fontSize: '0.9rem', marginBottom: '12px' }}>
            Reference Suite: <span className="tabular-nums" style={{ fontWeight: 600 }}>{REASONING_TEST_SUITE_V1.version}</span>
        </p>
        <p className="text-muted" style={{ fontSize: '0.85rem' }}>
            Complete the high-fidelity test suite to create an immutable behavioral anchor on the blockchain.
        </p>
      </div>

      {isLoadingTrait && (
          <p className="text-muted" style={{ fontStyle: 'italic', marginBottom: '20px' }}>Analyzing blockchain for existing baseline data...</p>
      )}

      {!isLoadingTrait && existingTrait && (
          <div className="plasma-card" style={{ 
              marginBottom: '32px', 
              background: 'rgba(245, 158, 11, 0.05)', 
              border: '1px solid rgba(245, 158, 11, 0.2)',
              padding: '16px' 
          }}>
              <p style={{ margin: '0 0 8px 0', fontWeight: 700, color: 'var(--plasma-warning-amber)', fontSize: '0.9rem' }}>🛡️ Managed Identity Detected</p>
              <p className="text-secondary" style={{ margin: 0, fontSize: '0.85rem', lineHeight: '1.5' }}>
                  This agent already has a baseline hash: <code className="tabular-nums" style={{ color: 'var(--plasma-text-primary)' }}>{existingTrait.hash.substring(0, 12)}...</code>.
                  Completing this suite will <strong>update</strong> the authoritative baseline on the cryptographic ledger.
              </p>
          </div>
      )}

      {!hashResult ? (
        <div className="plasma-card" style={{ background: 'var(--plasma-surface-2)' }}>
          <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="text-secondary" style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase' }}>
              Step {currentStep + 1} of {REASONING_TEST_SUITE_V1.prompts.length}
            </div>
            <span className="status-pill" style={{ background: 'var(--plasma-surface)', border: '1px solid var(--plasma-border)', color: 'var(--plasma-text-muted)' }}>
              {currentPrompt.category}
            </span>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label className="text-muted" style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: '12px' }}>Test Scenario</label>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', background: 'var(--plasma-bg)', padding: '16px', borderRadius: '8px', border: '1px solid var(--plasma-border)' }}>
              <p style={{ fontStyle: 'italic', margin: 0, flex: 1, lineHeight: '1.6', fontSize: '0.95rem', color: 'var(--plasma-text-secondary)' }}>{currentPrompt.prompt}</p>
              <button onClick={() => copyToClipboard(currentPrompt.prompt, 'prompt')} className="icon-btn">
                {copiedField === 'prompt' ? '✓' : '📋'}
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="text-muted" style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: '12px' }}>Baseline Response</label>
            <textarea
              value={responses[currentStep]}
              onChange={(e) => handleResponseChange(e.target.value)}
              placeholder="Paste the agent's verified output for this prompt..."
              className="form-input"
              style={{ minHeight: '180px' }}
              disabled={isRegistering}
            />
          </div>

          <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
            <button onClick={handlePrevious} disabled={currentStep === 0 || isRegistering} className="secondary-btn" style={{ padding: '10px 24px' }}>
              ← Previous
            </button>

            {!isLastPrompt ? (
              <button onClick={handleNext} disabled={!responses[currentStep].trim() || isRegistering} className="primary-btn" style={{ padding: '10px 24px' }}>
                Next Prompt →
              </button>
            ) : (
              <button onClick={handleGenerateHash} disabled={!allResponsesComplete || isRegistering} className="primary-btn" style={{ padding: '10px 32px', background: 'var(--plasma-integrity-green)' }}>
                Finalize Baseline
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="plasma-card">
          <div style={{ marginBottom: '24px', padding: '20px', background: 'rgba(79, 131, 255, 0.05)', borderRadius: '8px', border: '1px solid var(--plasma-clinical-blue)' }}>
            <h4 style={{ margin: '0 0 12px 0', color: 'var(--plasma-clinical-blue)' }}>Baseline Hash Calculated</h4>
            <code style={{ display: 'block', wordBreak: 'break-all', fontSize: '0.9rem', color: 'var(--plasma-text-primary)' }}>{hashResult.hash}</code>
            <p className="text-muted" style={{ marginTop: '12px', fontSize: '0.8rem' }}>Version: {hashResult.traitVersion}</p>
          </div>

          <div style={{ marginBottom: '32px' }}>
            <h4 className="text-secondary" style={{ fontSize: '0.9rem', marginBottom: '16px' }}>Package Summary</h4>
            {hashResult.responseSet.responses.map((response: any, idx: number) => (
              <details key={idx} style={{ marginBottom: '12px', background: 'var(--plasma-surface-2)', border: '1px solid var(--plasma-border)', borderRadius: '6px' }}>
                <summary style={{ cursor: 'pointer', padding: '12px', fontSize: '0.85rem', fontWeight: 600 }}>
                  Prompt {idx + 1}: {REASONING_TEST_SUITE_V1.prompts[idx].category}
                </summary>
                <div style={{ padding: '12px', borderTop: '1px solid var(--plasma-border)' }}>
                  <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '8px' }}>Scenario: {response.prompt}</p>
                  <p className="text-secondary" style={{ margin: 0, fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{response.response}</p>
                </div>
              </details>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '16px' }}>
            <button
              onClick={() => {
                setHashResult(null);
                setCurrentStep(REASONING_TEST_SUITE_V1.prompts.length - 1);
              }}
              className="secondary-btn"
              style={{ padding: '14px 24px' }}
            >
              ← Edit Responses
            </button>
            <button
              onClick={handleRegister}
              disabled={isRegistering}
              className="primary-btn"
              style={{ flex: 1, padding: '14px', fontWeight: 700 }}
            >
              {isRegistering ? 'Committing to Ledger...' : 'Commit Baseline to Ledger'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="plasma-card" style={{ marginTop: '24px', border: '1px solid var(--plasma-integrity-red)', background: 'rgba(239, 68, 68, 0.05)' }}>
          <p className="text-error" style={{ margin: 0 }}>{error}</p>
        </div>
      )}
    </div>
  );
};

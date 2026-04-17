import React, { useState } from 'react';
import { useBlockchain } from '../contexts/BlockchainContext';
import { REASONING_TEST_SUITE_V1 } from '../tests/behavioralTestSuite';
import {
  createManualResponseSet,
  generateBehavioralTraitHash,
    BehavioralHashResult,
    ResponseSet
} from '../utils/behavioral.utils';
import { C2PAService } from '../services/c2pa.service';
import { downloadC2PAManifest, getVerificationFilename } from '../utils/c2paExport.utils';

const c2paService = new C2PAService();

const REACT_APP_API_URL = process.env.REACT_APP_API_URL || '';
const REACT_APP_API_KEY = process.env.REACT_APP_API_KEY || '';

interface BehavioralVerificationProps {
  fingerprintHash: string;
}

export const BehavioralVerification: React.FC<BehavioralVerificationProps> = ({ fingerprintHash }) => {
  const { service, isConnected } = useBlockchain();
  const [responses, setResponses] = useState<string[]>(
    new Array(REASONING_TEST_SUITE_V1.prompts.length).fill('')
  );
  const [currentStep, setCurrentStep] = useState(0);
  const [hashResult, setHashResult] = useState<BehavioralHashResult | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
    const [gatewayResult, setGatewayResult] = useState<any | null>(null);
    const [lastAuditedHash, setLastAuditedHash] = useState<string | null>(null);
    const [baselineResponses, setBaselineResponses] = useState<ResponseSet | null>(null);
    const [mode, setMode] = useState<'enforcement' | 'triage'>('enforcement');
    const [error, setError] = useState<string | null>(null);
    const [exportStatus, setExportStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
    const [copiedField, setCopiedField] = useState<string | null>(null);

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

  const calculateInputHash = () => {
      // Deterministic stringification for stable hashing
      return JSON.stringify({
          mode,
          responses: responses.map(r => r.trim())
      });
  };

  const mapGatewayToVerificationResult = (agentId: string, data: any): any => {
      // Adapter layer: map backend-specific JSON to C2PA-compatible manifest-definition
      return {
          match: data.decision === 'accept',
          similarity: data.verification_details?.similarity_score || 0,
          confidence: (data.trust_score || 0) / 100,
          mode: mode,
          perturbation: {
              perturbationScore: data.verification_details?.perturbation_score || 0,
              suspicious: data.signals?.includes('suspicious_perturbations_detected') || false
          },
          decision: {
              reason: data.recommendations?.[0] || 'Verification completed',
              threshold: mode === 'enforcement' ? 0.95 : 0.80
          },
          traitVersion: REASONING_TEST_SUITE_V1.version
      };
  };

  const handleVerify = async () => {
    if (!service || !hashResult) return;

    setIsVerifying(true);
    setError(null);

    try {
        const res = await fetch(`${REACT_APP_API_URL}/v1/agents/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${REACT_APP_API_KEY}`
            },
            body: JSON.stringify({
                fingerprintHash,
                mode, // Pass the selected audit mode (enforcement or triage)
                currentResponseSet: hashResult.responseSet
            })
        });

        if (!res.ok) {
            throw new Error(`Gateway returned an error: ${res.statusText}`);
        }

        const data = await res.json();
        setGatewayResult(data);
        setLastAuditedHash(calculateInputHash());

    } catch (err: any) {
        setError(`Verification failed: ${err.message}`);
    } finally {
        setIsVerifying(false);
    }
  };

    const handleDownloadCertificate = async () => {
        if (!gatewayResult) return;
        setExportStatus(null);
        
        try {
            // Map the gateway output to a standard VerificationResult for the C2PA service
            const verificationResult = mapGatewayToVerificationResult(fingerprintHash, gatewayResult);
            
            const manifest = await c2paService.generateVerificationManifest(fingerprintHash, verificationResult);
            downloadC2PAManifest(manifest, getVerificationFilename(fingerprintHash));
            
            setExportStatus({ type: 'success', message: 'Audit Certificate exported successfully.' });
            setTimeout(() => setExportStatus(null), 3000);
        } catch (err: any) {
            console.error("Export failure:", err);
            setExportStatus({ type: 'error', message: `Export failed: ${err.message}` });
        }
    };

    const loadDemoBaseline = () => {
        const baseline = createManualResponseSet(REASONING_TEST_SUITE_V1, responses.map((r: string) => r + " As an AI, I believe this is the optimal approach."));
        setBaselineResponses(baseline);
    };

    const injectHomograph = () => {
        const newResponses = [...responses];
        if (newResponses[0]) {
            newResponses[0] = newResponses[0].replace(/a/gi, 'а').replace(/e/gi, 'е').replace(/o/gi, 'о');
            setResponses(newResponses);
            const responseSet = createManualResponseSet(REASONING_TEST_SUITE_V1, newResponses);
            const result = generateBehavioralTraitHash(responseSet);
            setHashResult(result);
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
        <p className="text-secondary">Please connect your provider wallet to perform behavioral drift audits.</p>
      </div>
    );
  }

  const isStale = !!gatewayResult && calculateInputHash() !== lastAuditedHash;

  return (
    <div className="behavioral-audit-flow">
      <div style={{ marginBottom: '32px' }}>
        <h3 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--plasma-text-primary)', marginBottom: '8px' }}>
            Behavioral Stability Audit
        </h3>
        <p className="text-secondary" style={{ fontSize: '0.9rem', marginBottom: '12px' }}>
            Testing Version: <span className="tabular-nums" style={{ fontWeight: 600 }}>{REASONING_TEST_SUITE_V1.version}</span>
        </p>
        <p className="text-muted" style={{ fontSize: '0.85rem' }}>
            Complete all {REASONING_TEST_SUITE_V1.prompts.length} prompts to verify behavioral consistency against baselines.
        </p>
      </div>

      <div className="plasma-card" style={{ background: 'var(--plasma-surface-2)' }}>
        <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="text-secondary" style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Prompt {currentStep + 1} of {REASONING_TEST_SUITE_V1.prompts.length}
          </div>
          <span className="status-pill" style={{ background: 'var(--plasma-surface)', border: '1px solid var(--plasma-border)', color: 'var(--plasma-text-muted)' }}>
            Category: {currentPrompt.category}
          </span>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label className="text-muted" style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: '12px', letterSpacing: '0.05em' }}>Clinical Scenario</label>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', background: 'var(--plasma-bg)', padding: '16px', borderRadius: '8px', border: '1px solid var(--plasma-border)' }}>
            <p style={{ fontStyle: 'italic', margin: 0, flex: 1, lineHeight: '1.6', fontSize: '0.95rem', color: 'var(--plasma-text-secondary)' }}>{currentPrompt.prompt}</p>
            <button
              onClick={() => copyToClipboard(currentPrompt.prompt, 'prompt')}
              className="icon-btn"
              title="Copy prompt"
            >
              {copiedField === 'prompt' ? '✓' : '📋'}
            </button>
          </div>
        </div>

        <div className="form-group">
          <label className="text-muted" style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: '12px', letterSpacing: '0.05em' }}>Agent Consensus Response</label>
          <textarea
            value={responses[currentStep]}
            onChange={(e) => handleResponseChange(e.target.value)}
            placeholder="Enter the AI agent's response for this scenario..."
            className="form-input"
            style={{ minHeight: '180px', lineHeight: '1.6' }}
            disabled={isVerifying}
          />
        </div>

        <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
          <button
            onClick={handlePrevious}
            disabled={currentStep === 0 || isVerifying}
            className="secondary-btn"
            style={{ padding: '10px 24px' }}
          >
            ← Previous
          </button>

          {!isLastPrompt ? (
            <button
              onClick={handleNext}
              disabled={!responses[currentStep].trim() || isVerifying}
              className="primary-btn"
              style={{ padding: '10px 24px' }}
            >
              Next Prompt →
            </button>
          ) : (
            <button
              onClick={handleGenerateHash}
              disabled={!allResponsesComplete || isVerifying}
              className="primary-btn"
              style={{ padding: '10px 32px', background: 'var(--plasma-integrity-green)' }}
            >
              Generate Audit Package
            </button>
          )}
        </div>
      </div>

      {hashResult && (
        <div className="plasma-card" style={{ 
            marginTop: '24px', 
            border: '1px solid var(--plasma-clinical-blue)',
            opacity: isVerifying ? 0.7 : 1
        }}>
            <h4 className="text-secondary" style={{ margin: '0 0 16px 0', textTransform: 'uppercase', fontSize: '0.8rem', letterSpacing: '0.05em' }}>
              Audit Configuration
            </h4>
            
            <div className="form-group" style={{ marginBottom: '24px' }}>
                <label className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '8px', display: 'block' }}>Security Mode</label>
                <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as any)}
                    className="form-input"
                    style={{ background: 'var(--plasma-surface-2)' }}
                    disabled={isVerifying}
                >
                    <option value="enforcement">Strict Enforcement (95%+)</option>
                    <option value="triage">Triage Advisory (80%+)</option>
                </select>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
                <button
                    onClick={loadDemoBaseline}
                    className="secondary-btn"
                    style={{ fontSize: '0.8rem', flex: 1 }}
                    disabled={isVerifying}
                >
                    📥 Demo Baseline
                </button>
                <button
                    onClick={injectHomograph}
                    className="secondary-btn"
                    style={{ fontSize: '0.8rem', flex: 1, border: '1px solid rgba(239, 68, 68, 0.3)' }}
                    disabled={isVerifying}
                >
                    🧬 Inject Attack
                </button>
            </div>

            {(() => {
                const currentHash = calculateInputHash();
                const hasResult = !!gatewayResult;
                const isAlreadyAudited = hasResult && currentHash === lastAuditedHash;
                
                let label = isVerifying ? 'Analyzing Stability...' : 'Safety-Grade Audit';
                if (isAlreadyAudited) {
                  label = 'Audit Completed';
                } else if (hasResult || isStale) {
                  label = 'Regenerate Audit Package';
                }

                return (
                    <button
                      onClick={handleVerify}
                      disabled={isVerifying || isAlreadyAudited}
                      className="primary-btn"
                      style={{ 
                          width: '100%', 
                          padding: '16px', 
                          fontWeight: 700, 
                          fontSize: '1rem',
                          background: isAlreadyAudited ? 'var(--plasma-surface-2)' : (hasResult || isStale ? 'var(--plasma-warning-amber)' : undefined),
                          color: isAlreadyAudited ? 'var(--plasma-text-muted)' : (hasResult || isStale ? 'black' : undefined),
                          cursor: (isAlreadyAudited) ? 'default' : 'pointer'
                      }}
                    >
                      {isAlreadyAudited ? '✓ ' : ''}{label}
                    </button>
                );
            })()}
        </div>
      )}

      {gatewayResult && (
        <div className="behavioral-audit-result-view" style={{ marginTop: '24px' }}>
          {isStale && (
            <div style={{ 
              background: 'var(--plasma-warning-amber)', 
              color: 'black', 
              padding: '12px', 
              borderRadius: '8px 8px 0 0', 
              textAlign: 'center',
              fontWeight: 700,
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}>
              <span>⚠️</span> Results out of date – inputs changed; run audit again
            </div>
          )}
          
          <div className="plasma-card" style={{ 
                border: gatewayResult.decision === 'accept' ? '2px solid var(--plasma-integrity-green)' : '2px solid var(--plasma-warning-amber)',
                opacity: isStale ? 0.6 : 1,
                transition: 'opacity 0.2s ease',
                borderRadius: isStale ? '0 0 8px 8px' : '8px'
          }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                    <h3 style={{ margin: 0, color: gatewayResult.decision === 'accept' ? 'var(--plasma-integrity-green)' : 'var(--plasma-warning-amber)' }}>
                        {gatewayResult.decision === 'accept' ? '✅ Audit Passed: Baseline Consistent' : '⚠️ Audit Warning: Behavioral Drift Detected'}
                    </h3>
                    <div className="text-muted" style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        Agent: <span className="tabular-nums">{fingerprintHash.substring(0, 10)}...</span>
                        <button
                            onClick={() => copyToClipboard(fingerprintHash, 'fingerprint')}
                            className="icon-btn"
                            title="Copy Fingerprint Hash"
                        >
                            {copiedField === 'fingerprint' ? '✓' : '📋'}
                        </button>
                    </div>
                </div>

                <div style={{ marginBottom: '24px' }}>
                    <span className="status-pill" style={{
                        background: mode === 'enforcement' ? 'rgba(79, 131, 255, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                        color: mode === 'enforcement' ? 'var(--plasma-clinical-blue)' : 'var(--plasma-warning-amber)',
                        textTransform: 'uppercase'
                    }}>
                        Mode: {mode}
                    </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '32px' }}>
                    <div style={{ padding: '20px', background: 'var(--plasma-surface-2)', borderRadius: '8px', textAlign: 'center', border: '1px solid var(--plasma-border)' }}>
                        <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '8px', fontWeight: 600, textTransform: 'uppercase' }}>Stability Match</div>
                        <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--plasma-text-primary)' }}>
                            {(gatewayResult.verification_details?.similarity_score * 100).toFixed(1)}%
                        </div>
                    </div>
                    <div style={{ padding: '20px', background: 'rgba(79, 131, 255, 0.05)', borderRadius: '8px', textAlign: 'center', border: '2px solid var(--plasma-clinical-blue)' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--plasma-clinical-blue)', marginBottom: '8px', fontWeight: 700, textTransform: 'uppercase' }}>Integrity Score</div>
                        <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--plasma-text-primary)' }}>{gatewayResult.trust_score}<span style={{ fontSize: '0.8rem', opacity: 0.5 }}> / 100</span></div>
                    </div>
                </div>

                <div style={{ marginBottom: '32px', padding: '20px', background: 'var(--plasma-surface-2)', border: '1px solid var(--plasma-border)', borderRadius: '8px' }}>
                    <h4 className="text-secondary" style={{ margin: '0 0 16px 0', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Behavioral Signals</h4>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                        {gatewayResult.signals?.length > 0 ? gatewayResult.signals.map((signal: string, idx: number) => (
                            <span key={idx} className="status-pill" style={{
                                background: 'rgba(16, 185, 129, 0.1)',
                                color: 'var(--plasma-integrity-green)',
                                border: '1px solid rgba(16, 185, 129, 0.2)',
                                fontSize: '0.7rem'
                            }}>
                                🛡️ {signal.replace(/_/g, ' ')}
                            </span>
                        )) : (
                            <div className="text-muted" style={{ fontSize: '0.85rem' }}>No anomalies detected.</div>
                        )}
                    </div>
                </div>

                {gatewayResult.recommendations && gatewayResult.recommendations.length > 0 && (
                    <div style={{ padding: '20px', background: 'rgba(245, 158, 11, 0.05)', borderRadius: '8px', marginBottom: '32px', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                        <strong style={{ color: 'var(--plasma-warning-amber)', display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>🛡️ Clinical Recommendations:</strong>
                        <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--plasma-text-secondary)', fontSize: '0.9rem', lineHeight: '1.6' }}>
                            {gatewayResult.recommendations.map((rec: string, i: number) => (
                                <li key={i}>{rec}</li>
                            ))}
                        </ul>
                    </div>
                )}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center' }}>
                    <button onClick={() => {
                        setGatewayResult(null);
                        setLastAuditedHash(null);
                        setHashResult(null);
                        setResponses(new Array(REASONING_TEST_SUITE_V1.prompts.length).fill(''));
                        setBaselineResponses(null);
                        setCurrentStep(0);
                    }} className="secondary-btn" style={{ flex: 1, padding: '14px' }}>
                         Clear All Responses
                    </button>

                    <button
                        onClick={handleDownloadCertificate}
                        className="primary-btn"
                        style={{ flex: 1, padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}
                        disabled={isStale}
                    >
                        <span>🛡️</span> Export Audit Cert
                    </button>
                    
                    {exportStatus && (
                        <div style={{ 
                            width: '100%', 
                            marginTop: '12px', 
                            padding: '10px', 
                            borderRadius: '6px', 
                            fontSize: '0.85rem',
                            textAlign: 'center',
                            background: exportStatus.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                            color: exportStatus.type === 'success' ? 'var(--plasma-integrity-green)' : 'var(--plasma-integrity-red)',
                            border: `1px solid ${exportStatus.type === 'success' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`
                        }}>
                            {exportStatus.type === 'success' ? '✅' : '❌'} {exportStatus.message}
                        </div>
                    )}
                </div>
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

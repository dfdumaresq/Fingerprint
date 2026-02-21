import React, { useState } from 'react';
import { useBlockchain } from '../contexts/BlockchainContext';
import { REASONING_TEST_SUITE_V1 } from '../tests/behavioralTestSuite';
import {
  createManualResponseSet,
  generateBehavioralTraitHash,
    BehavioralHashResult,
    VerificationResult,
    ResponseSet
} from '../utils/behavioral.utils';
import { C2PAService } from '../services/c2pa.service';
import { downloadC2PAManifest, getVerificationFilename } from '../utils/c2paExport.utils';

const c2paService = new C2PAService();

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
    const [safetyResult, setSafetyResult] = useState<VerificationResult | null>(null);
    const [baselineResponses, setBaselineResponses] = useState<ResponseSet | null>(null);
    const [mode, setMode] = useState<'enforcement' | 'triage'>('enforcement');
  const [error, setError] = useState<string | null>(null);
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

  const handleVerify = async () => {
    if (!service || !hashResult) return;

      // FOR DEMO: If no baseline loaded, use the current responses as baseline (100% match demo)
      // In production, this would be retrieved from a secure sidecar.
      const referenceResponses = baselineResponses || hashResult.responseSet;

    setIsVerifying(true);
    setError(null);

    try {
        const result = service.verifyBehavioralSafety(
            referenceResponses,
            hashResult.responseSet,
            mode
        );

        setSafetyResult(result);
    } catch (err: any) {
        setError(`Verification failed: ${err.message}`);
    } finally {
        setIsVerifying(false);
    }
  };

    const handleDownloadCertificate = async () => {
        if (!safetyResult) return;
        try {
            const manifest = await c2paService.generateVerificationManifest(fingerprintHash, safetyResult);
            downloadC2PAManifest(manifest, getVerificationFilename(fingerprintHash));
        } catch (err: any) {
            setError(`Failed to export certificate: ${err.message}`);
        }
    };

    const loadDemoBaseline = () => {
        // Load a slightly different version as baseline to show similarity < 100%
        const baseline = createManualResponseSet(REASONING_TEST_SUITE_V1, responses.map((r: string) => r + " "));
        setBaselineResponses(baseline);
        alert("Baseline loaded! Now try verifying to see similarity results.");
    };

    const injectHomograph = () => {
        const newResponses = [...responses];
        // Replace 'a' with Cyrillic 'а'
        newResponses[currentStep] = newResponses[currentStep].replace(/a/g, 'а');
        setResponses(newResponses);
        alert("Injected Cyrillic 'а' homographs! The perturbation detector should flag this.");
    };

    const copyToClipboard = (text: string, field: string) => {
        navigator.clipboard.writeText(text);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
    };

  if (!isConnected) {
    return (
      <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '5px' }}>
        <h3>Behavioral Trait Verification</h3>
        <p style={{ color: '#f44336' }}>Please connect your wallet first.</p>
      </div>
    );
  }

    if (safetyResult) {
        const isSuccess = safetyResult.match;
        const similarityPercent = (safetyResult.similarity * 100).toFixed(1);
        const confidencePercent = (safetyResult.confidence * 100).toFixed(1);
        const perturbationScore = (safetyResult.perturbation.perturbationScore * 100).toFixed(1);

    return (
      <div style={{
            padding: '24px',
            border: isSuccess ? '2px solid #4caf50' : '2px solid #ff9800',
            borderRadius: '12px',
            background: '#fff',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
      }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h3 style={{ margin: 0, color: isSuccess ? '#2e7d32' : '#ed6c02' }}>
                    {isSuccess ? '✅ Verification Passed' : '⚠️ Verification Attention Required'}
                </h3>
                <div style={{ fontSize: '12px', color: '#666', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    Agent ID: {fingerprintHash.substring(0, 10)}...
                    <button
                        onClick={() => copyToClipboard(fingerprintHash, 'fingerprint')}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', padding: 0 }}
                        title="Copy Fingerprint Hash"
                    >
                        {copiedField === 'fingerprint' ? '✅' : '📋'}
                    </button>
                </div>
            </div>
            <span style={{
                padding: '4px 12px',
                borderRadius: '20px',
                background: safetyResult.mode === 'enforcement' ? '#e3f2fd' : '#fff3e0',
                fontSize: '12px',
                fontWeight: 'bold',
                color: safetyResult.mode === 'enforcement' ? '#1976d2' : '#e65100',
                textTransform: 'uppercase'
            }}>
                {safetyResult.mode} mode
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                <div style={{ padding: '16px', background: '#f8f9fa', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Similarity Score</div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{similarityPercent}%</div>
                </div>
                <div style={{ padding: '16px', background: '#f8f9fa', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Confidence</div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{confidencePercent}%</div>
                </div>
            </div>

            <div style={{ marginBottom: '20px', padding: '16px', border: '1px solid #eee', borderRadius: '8px' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '14px' }}>Perturbation Analysis</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                        <span>Composite Perturbation:</span>
                        <span style={{ fontWeight: 'bold' }}>{perturbationScore}%</span>
                    </div>

                    {safetyResult.perturbation.flags.length > 0 ? (
                        <div style={{ marginTop: '8px' }}>
                            <div style={{ fontSize: '11px', color: '#d32f2f', fontWeight: 'bold', marginBottom: '4px' }}>Detected Artifacts:</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {safetyResult.perturbation.flags.map((flag: any, idx: number) => (
                                    <span key={idx} style={{
                                        fontSize: '10px',
                                        background: flag.severity === 'high' ? '#ffebee' : '#fff3e0',
                                        color: flag.severity === 'high' ? '#c62828' : '#e65100',
                                        padding: '2px 8px',
                                        borderRadius: '4px',
                                        border: `1px solid ${flag.severity === 'high' ? '#ef9a9a' : '#ffe0b2'}`
                                    }} title={flag.evidence ? `Evidence: ${flag.evidence}` : flag.description}>
                                        {flag.description}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div style={{ fontSize: '11px', color: '#388e3c' }}>✓ No suspicious perturbations detected.</div>
                    )}
                </div>
            </div>

            <div style={{ padding: '12px', background: '#f5f5f5', borderRadius: '8px', marginBottom: '24px', fontSize: '13px' }}>
                <strong>Verdict Reason:</strong> {safetyResult.decision.reason}
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
                <button onClick={() => {
                    setSafetyResult(null);
                    setHashResult(null);
                    setResponses(new Array(REASONING_TEST_SUITE_V1.prompts.length).fill(''));
                    setCurrentStep(0);
                }} style={{
                    flex: 1,
                    padding: '12px',
                    border: '1px solid #ccc',
                    borderRadius: '6px',
                    background: '#fff',
                    cursor: 'pointer'
                }}>
                    Verify Again
                </button>

                <button
                    onClick={handleDownloadCertificate}
                    style={{
                        flex: 1,
                        padding: '12px',
                        background: '#1976d2',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px'
                    }}
                >
                    <span>🛡️</span> Download C2PA Cert
                </button>
            </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '5px' }}>
      <h3>Behavioral Trait Verification</h3>
      <p>Fingerprint: <code>{fingerprintHash}</code></p>

      {!hashResult ? (
        <>
          <div style={{ marginBottom: '20px' }}>
            <h4>Test Suite: {REASONING_TEST_SUITE_V1.version}</h4>
            <p>Complete all {REASONING_TEST_SUITE_V1.prompts.length} prompts to verify behavioral traits.</p>
          </div>

          <div style={{ marginBottom: '20px', padding: '15px', background: '#f5f5f5', borderRadius: '5px' }}>
            <div style={{ marginBottom: '10px' }}>
              <strong>Prompt {currentStep + 1} of {REASONING_TEST_SUITE_V1.prompts.length}</strong>
              <span style={{ float: 'right', fontSize: '12px', color: '#666' }}>
                Category: {currentPrompt.category}
              </span>
            </div>
            <p><strong>Question:</strong></p>
            <p style={{ fontStyle: 'italic', marginBottom: '15px' }}>{currentPrompt.prompt}</p>

            <textarea
              value={responses[currentStep]}
              onChange={(e) => handleResponseChange(e.target.value)}
              placeholder="Enter your AI agent's response here..."
              style={{
                width: '100%',
                minHeight: '150px',
                padding: '10px',
                fontSize: '14px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontFamily: 'inherit'
              }}
            />

            <div style={{ marginTop: '15px', display: 'flex', justifyContent: 'space-between' }}>
              <button
                onClick={handlePrevious}
                disabled={currentStep === 0}
                style={{ padding: '8px 16px' }}
              >
                ← Previous
              </button>

              {!isLastPrompt ? (
                <button
                  onClick={handleNext}
                  disabled={!responses[currentStep].trim()}
                  style={{ padding: '8px 16px' }}
                >
                  Next →
                </button>
              ) : (
                <button
                  onClick={handleGenerateHash}
                  disabled={!allResponsesComplete}
                  style={{ padding: '8px 16px', background: '#4caf50', color: 'white', border: 'none', borderRadius: '4px' }}
                >
                  Generate Hash for Verification
                </button>
              )}
            </div>
          </div>

          <div style={{ fontSize: '12px', color: '#666' }}>
            <p><strong>Progress:</strong> {responses.filter(r => r.trim()).length} / {REASONING_TEST_SUITE_V1.prompts.length} responses completed</p>
          </div>
        </>
      ) : (
        <>
          <div style={{ marginBottom: '20px', padding: '15px', background: '#e3f2fd', borderRadius: '5px' }}>
            <h4>Current Behavioral Hash Generated</h4>
            <p><strong>Hash:</strong></p>
            <code style={{ wordBreak: 'break-all', fontSize: '12px' }}>{hashResult.hash}</code>
            <p style={{ marginTop: '10px' }}><strong>Version:</strong> {hashResult.traitVersion}</p>
          </div>

                      <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #bbdefb', borderRadius: '5px' }}>
                          <h5 style={{ marginTop: 0 }}>Safety Configuration</h5>
                          <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                              <label>Mode:</label>
                              <select
                                  value={mode}
                                  onChange={(e) => setMode(e.target.value as any)}
                                  style={{ padding: '4px 8px', borderRadius: '4px' }}
                              >
                                  <option value="enforcement">Enforcement (Strict - 95%)</option>
                                  <option value="triage">Triage (Loose - 80%)</option>
                              </select>
                          </div>
                          <div style={{ marginTop: '15px', display: 'flex', gap: '10px' }}>
                              <button
                                  onClick={loadDemoBaseline}
                                  style={{
                                      fontSize: '12px',
                                      padding: '6px 12px',
                                      background: '#fff',
                                      color: '#333',
                                      border: '1px solid #007bff',
                                      borderRadius: '4px',
                                      cursor: 'pointer',
                                      boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                                  }}
                              >
                                  📥 Load Reference Baseline (Demo)
                              </button>
                              <button
                                  onClick={injectHomograph}
                                  style={{
                                      fontSize: '12px',
                                      padding: '6px 12px',
                                      background: '#fff',
                                      color: '#333',
                                      border: '1px solid #dc3545',
                                      borderRadius: '4px',
                                      cursor: 'pointer',
                                      boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                                  }}
                              >
                                  🧬 Inject Homographs (Attack Demo)
                              </button>
                          </div>
                      </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => {
                setHashResult(null);
                setCurrentStep(REASONING_TEST_SUITE_V1.prompts.length - 1);
              }}
              style={{ padding: '10px 20px' }}
            >
              ← Back to Edit
            </button>
            <button
              onClick={handleVerify}
              disabled={isVerifying}
              style={{
                padding: '10px 20px',
                background: '#2196f3',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                  flex: 1,
                  fontWeight: 'bold'
              }}
            >
                              {isVerifying ? 'Analyzing Stability...' : 'Safety-Grade Verification'}
            </button>
          </div>
        </>
      )}

      {error && (
        <div style={{ marginTop: '15px', padding: '10px', background: '#ffebee', border: '1px solid #f44336', borderRadius: '4px', color: '#c62828' }}>
          {error}
        </div>
      )}
    </div>
  );
};

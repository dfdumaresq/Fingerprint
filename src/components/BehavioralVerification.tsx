import React, { useState } from 'react';
import { useBlockchain } from '../contexts/BlockchainContext';
import { REASONING_TEST_SUITE_V1 } from '../tests/behavioralTestSuite';
import {
  createManualResponseSet,
  generateBehavioralTraitHash,
  BehavioralHashResult
} from '../utils/behavioral.utils';

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
  const [verificationResult, setVerificationResult] = useState<{
    exists: boolean;
    matches: boolean;
    storedHash?: string;
    storedVersion?: string;
    registeredAt?: number;
    lastUpdatedAt?: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

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

    setIsVerifying(true);
    setError(null);

    try {
      // Get the stored behavioral trait data
      const storedData = await service.getBehavioralTraitData(fingerprintHash);

      if (!storedData || !storedData.exists) {
        setVerificationResult({
          exists: false,
          matches: false
        });
        setError('No behavioral trait registered for this fingerprint.');
        setIsVerifying(false);
        return;
      }

      // Verify if the current hash matches the stored hash
      const verifyResult = await service.verifyBehavioralMatch(fingerprintHash, hashResult.hash);

      setVerificationResult({
        exists: true,
        matches: verifyResult.matches,
        storedHash: storedData.traitHash || '',
        storedVersion: storedData.traitVersion || '',
        registeredAt: storedData.registeredAt || 0,
        lastUpdatedAt: storedData.lastUpdatedAt || 0
      });

      console.log('Verification result:', { verifyResult, storedData });
    } catch (err: any) {
      setError(`Verification failed: ${err.message}`);
    } finally {
      setIsVerifying(false);
    }
  };

  if (!isConnected) {
    return (
      <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '5px' }}>
        <h3>Behavioral Trait Verification</h3>
        <p style={{ color: '#f44336' }}>Please connect your wallet first.</p>
      </div>
    );
  }

  if (verificationResult) {
    return (
      <div style={{
        padding: '20px',
        border: verificationResult.matches ? '1px solid #4caf50' : '1px solid #ff9800',
        borderRadius: '5px'
      }}>
        <h3>{verificationResult.matches ? '✅ Behavioral Match Verified!' : '⚠️ Behavioral Drift Detected'}</h3>

        <div style={{ marginBottom: '20px', padding: '15px', background: '#f5f5f5', borderRadius: '5px' }}>
          <p><strong>Fingerprint Hash:</strong></p>
          <code style={{ wordBreak: 'break-all', fontSize: '12px' }}>{fingerprintHash}</code>

          <p style={{ marginTop: '15px' }}><strong>Current Hash:</strong></p>
          <code style={{ wordBreak: 'break-all', fontSize: '12px' }}>{hashResult?.hash}</code>

          <p style={{ marginTop: '15px' }}><strong>Stored Hash:</strong></p>
          <code style={{ wordBreak: 'break-all', fontSize: '12px' }}>{verificationResult.storedHash}</code>

          <p style={{ marginTop: '15px' }}><strong>Test Suite Version:</strong> {verificationResult.storedVersion}</p>

          {verificationResult.registeredAt && (
            <p><strong>Registered:</strong> {new Date(verificationResult.registeredAt * 1000).toLocaleString()}</p>
          )}

          {verificationResult.lastUpdatedAt && verificationResult.lastUpdatedAt !== verificationResult.registeredAt && (
            <p><strong>Last Updated:</strong> {new Date(verificationResult.lastUpdatedAt * 1000).toLocaleString()}</p>
          )}
        </div>

        {verificationResult.matches ? (
          <div style={{ padding: '15px', background: '#e8f5e9', borderRadius: '5px', marginBottom: '20px' }}>
            <p><strong>✓ Verification Passed</strong></p>
            <p>The AI agent's current behavioral traits match the registered baseline. No significant drift detected.</p>
          </div>
        ) : (
          <div style={{ padding: '15px', background: '#fff3e0', borderRadius: '5px', marginBottom: '20px' }}>
            <p><strong>⚠ Drift Detected</strong></p>
            <p>The AI agent's behavioral traits have changed compared to the registered baseline. This could indicate:</p>
            <ul style={{ marginLeft: '20px', marginTop: '10px' }}>
              <li>Model update or replacement</li>
              <li>Fine-tuning or prompt changes</li>
              <li>Configuration drift</li>
            </ul>
            <p style={{ marginTop: '10px' }}>Consider updating the registered behavioral trait if this change is intentional.</p>
          </div>
        )}

        <button onClick={() => {
          setVerificationResult(null);
          setHashResult(null);
          setResponses(new Array(REASONING_TEST_SUITE_V1.prompts.length).fill(''));
          setCurrentStep(0);
        }} style={{ padding: '10px 20px' }}>
          Verify Again
        </button>
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
                flex: 1
              }}
            >
              {isVerifying ? 'Verifying with Blockchain...' : 'Verify Against Blockchain'}
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
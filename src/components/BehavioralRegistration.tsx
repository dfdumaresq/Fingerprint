import React, { useState } from 'react';
import { useBlockchain } from '../contexts/BlockchainContext';
import { REASONING_TEST_SUITE_V1, TestPrompt } from '../tests/behavioralTestSuite';
import {
  createManualResponseSet,
  generateBehavioralTraitHash,
  BehavioralHashResult
} from '../utils/behavioral.utils';

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
      const result = await service.registerBehavioralTrait(
        fingerprintHash,
        hashResult.hash,
        hashResult.traitVersion
      );

      if (result.success) {
        setRegistrationSuccess(true);
        console.log('Behavioral trait registered:', result);
      }
    } catch (err: any) {
      setError(`Registration failed: ${err.message}`);
    } finally {
      setIsRegistering(false);
    }
  };

  if (!isConnected) {
    return (
      <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '5px' }}>
        <h3>Behavioral Trait Registration</h3>
        <p style={{ color: '#f44336' }}>Please connect your wallet first.</p>
      </div>
    );
  }

  if (registrationSuccess) {
    return (
      <div style={{ padding: '20px', border: '1px solid #4caf50', borderRadius: '5px' }}>
        <h3>✅ Behavioral Trait Registered Successfully!</h3>
        <p><strong>Fingerprint Hash:</strong> {fingerprintHash}</p>
        <p><strong>Trait Hash:</strong> {hashResult?.hash}</p>
        <p><strong>Version:</strong> {hashResult?.traitVersion}</p>
        <button onClick={() => {
          setRegistrationSuccess(false);
          setHashResult(null);
          setResponses(new Array(REASONING_TEST_SUITE_V1.prompts.length).fill(''));
          setCurrentStep(0);
        }}>
          Register Another
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '5px' }}>
      <h3>Behavioral Trait Registration</h3>
      <p>Fingerprint: <code>{fingerprintHash}</code></p>

      {!hashResult ? (
        <>
          <div style={{ marginBottom: '20px' }}>
            <h4>Test Suite: {REASONING_TEST_SUITE_V1.version}</h4>
            <p>Complete all {REASONING_TEST_SUITE_V1.prompts.length} prompts to generate your behavioral trait hash.</p>
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
              placeholder="Enter your response here..."
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
                  Generate Behavioral Hash
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
            <h4>Behavioral Hash Generated</h4>
            <p><strong>Hash:</strong></p>
            <code style={{ wordBreak: 'break-all', fontSize: '12px' }}>{hashResult.hash}</code>
            <p style={{ marginTop: '10px' }}><strong>Version:</strong> {hashResult.traitVersion}</p>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <h4>Response Summary</h4>
            {hashResult.responseSet.responses.map((response, idx) => (
              <details key={idx} style={{ marginBottom: '10px' }}>
                <summary style={{ cursor: 'pointer', padding: '5px', background: '#f5f5f5' }}>
                  Prompt {idx + 1}: {REASONING_TEST_SUITE_V1.prompts[idx].category}
                </summary>
                <div style={{ padding: '10px', fontSize: '12px' }}>
                  <p><strong>Question:</strong> {response.prompt}</p>
                  <p><strong>Your Response:</strong></p>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{response.response}</p>
                </div>
              </details>
            ))}
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
              onClick={handleRegister}
              disabled={isRegistering}
              style={{
                padding: '10px 20px',
                background: '#2196f3',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                flex: 1
              }}
            >
              {isRegistering ? 'Registering on Blockchain...' : 'Register Behavioral Trait'}
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
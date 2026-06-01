import React, { useState } from 'react';
import { REASONING_TEST_SUITE_V1 } from '../tests/behavioralTestSuite';

export type StepperMode = 'baseline' | 'audit';

interface PromptStepperProps {
  mode: StepperMode;
  disabled?: boolean;
  onComplete: (responses: string[]) => void;
  onCancel: () => void;
}

const MODE_LABELS: Record<StepperMode, { finalize: string; context: string }> = {
  baseline: {
    finalize: 'Finalize Baseline',
    context: 'Paste the agent\'s verified output for this prompt.',
  },
  audit: {
    finalize: 'Generate Audit Package',
    context: 'Enter the live agent\'s response for this prompt.',
  },
};

export const PromptStepper: React.FC<PromptStepperProps> = ({
  mode,
  disabled = false,
  onComplete,
  onCancel,
}) => {
  const prompts = REASONING_TEST_SUITE_V1.prompts;
  const [responses, setResponses] = useState<string[]>(
    new Array(prompts.length).fill('')
  );
  const [step, setStep] = useState(0);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const currentPrompt = prompts[step];
  const isLast = step === prompts.length - 1;
  const allComplete = responses.every(r => r.trim().length > 0);
  const labels = MODE_LABELS[mode];

  const handleChange = (value: string) => {
    const next = [...responses];
    next[step] = value;
    setResponses(next);
  };

  const copyPrompt = () => {
    navigator.clipboard.writeText(currentPrompt.prompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  // Progress bar fill
  const progress = Math.round(((step + 1) / prompts.length) * 100);

  return (
    <div className="prompt-stepper">
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '10px',
        }}>
          <span className="text-secondary" style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Prompt {step + 1} of {prompts.length}
          </span>
          <span className="status-pill" style={{
            background: 'var(--plasma-surface)',
            border: '1px solid var(--plasma-border)',
            color: 'var(--plasma-text-muted)',
          }}>
            {currentPrompt.category.replace(/_/g, ' ')}
          </span>
        </div>

        {/* Progress bar */}
        <div style={{
          height: '3px',
          background: 'var(--plasma-surface-2)',
          borderRadius: '2px',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${progress}%`,
            background: mode === 'baseline'
              ? 'var(--plasma-integrity-green)'
              : 'var(--plasma-clinical-blue)',
            borderRadius: '2px',
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      {/* Prompt display */}
      <div className="plasma-card" style={{ background: 'var(--plasma-surface-2)', marginBottom: '20px' }}>
        <div style={{ marginBottom: '16px' }}>
          <label className="text-muted" style={{
            display: 'block',
            fontSize: '0.72rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: '10px',
          }}>
            Test Scenario
          </label>
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            background: 'var(--plasma-bg)',
            padding: '14px',
            borderRadius: '8px',
            border: '1px solid var(--plasma-border)',
          }}>
            <p style={{
              fontStyle: 'italic',
              margin: 0,
              flex: 1,
              lineHeight: '1.65',
              fontSize: '0.95rem',
              color: 'var(--plasma-text-secondary)',
            }}>
              {currentPrompt.prompt}
            </p>
            <button
              onClick={copyPrompt}
              className="icon-btn"
              title="Copy prompt"
              style={{ flexShrink: 0 }}
            >
              {copiedPrompt ? '✓' : '📋'}
            </button>
          </div>
        </div>

        {/* Response textarea */}
        <div className="form-group">
          <label className="text-muted" style={{
            fontSize: '0.72rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: '10px',
          }}>
            {mode === 'baseline' ? 'Baseline Response' : 'Agent Consensus Response'}
          </label>
          <textarea
            value={responses[step]}
            onChange={e => handleChange(e.target.value)}
            placeholder={labels.context}
            className="form-input"
            style={{ minHeight: '180px', lineHeight: '1.6' }}
            disabled={disabled}
          />
        </div>
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
        <button
          onClick={onCancel}
          className="secondary-btn"
          style={{ padding: '10px 20px', fontSize: '0.85rem' }}
          disabled={disabled}
        >
          ← Cancel
        </button>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => setStep(s => s - 1)}
            disabled={step === 0 || disabled}
            className="secondary-btn"
            style={{ padding: '10px 20px' }}
          >
            Previous
          </button>

          {!isLast ? (
            <button
              onClick={() => setStep(s => s + 1)}
              disabled={!responses[step].trim() || disabled}
              className="primary-btn"
              style={{ padding: '10px 24px' }}
            >
              Next →
            </button>
          ) : (
            <button
              onClick={() => onComplete(responses)}
              disabled={!allComplete || disabled}
              className="primary-btn"
              style={{
                padding: '10px 28px',
                fontWeight: 700,
                background: mode === 'baseline'
                  ? 'var(--plasma-integrity-green)'
                  : undefined,
              }}
            >
              {labels.finalize}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

import React, { useState, useEffect, useRef } from 'react';
import { REASONING_TEST_SUITE_V1 } from '../tests/behavioralTestSuite';

export type StepperMode = 'baseline' | 'audit';

interface BaselineFixture {
  fingerprintHash: string;
  agentName: string | null;
  suiteVersion: string;
  responses: string[];
  savedAt: string;
}

interface PromptStepperProps {
  mode: StepperMode;
  disabled?: boolean;
  onComplete: (responses: string[]) => void;
  onCancel: () => void;
  // Fixture props — required for record/replay (baseline mode only)
  agentFingerprintHash?: string;
  agentName?: string;
  suiteVersion?: string;
  apiBaseUrl?: string;
  apiToken?: string;
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
  agentFingerprintHash,
  agentName,
  suiteVersion,
  apiBaseUrl = process.env.REACT_APP_API_URL || '',
  apiToken = process.env.REACT_APP_API_KEY || '',
}) => {
  const prompts = REASONING_TEST_SUITE_V1.prompts;
  const [responses, setResponses] = useState<string[]>(new Array(prompts.length).fill(''));
  const [step, setStep] = useState(0);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  // Fixture state (baseline mode only)
  const [fixture, setFixture] = useState<BaselineFixture | null>(null);
  const [fixtureLoading, setFixtureLoading] = useState(false);
  const [fixtureBannerDismissed, setFixtureBannerDismissed] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [clearStatus, setClearStatus] = useState<'idle' | 'clearing' | 'cleared'>('idle');

  // Client-side import state & input ref
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);


  const currentPrompt = prompts[step];
  const isLast = step === prompts.length - 1;
  const allComplete = responses.every(r => r.trim().length > 0);
  const labels = MODE_LABELS[mode];
  const progress = Math.round(((step + 1) / prompts.length) * 100);

  const canLoadFixture = !!agentFingerprintHash;  // both modes
  const canSaveFixture = mode === 'baseline' && !!agentFingerprintHash;  // baseline only

  // ── On mount: check for a saved fixture ─────────────────────────────────────
  useEffect(() => {
    if (!canLoadFixture) return;
    setFixtureLoading(true);
    const suite = suiteVersion || REASONING_TEST_SUITE_V1.version;
    fetch(`${apiBaseUrl}/v1/fixtures/${encodeURIComponent(agentFingerprintHash!)}?suite=${encodeURIComponent(suite)}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data && !data.error) setFixture(data); })
      .catch(() => {/* 404 = no fixture yet, that's fine */})
      .finally(() => setFixtureLoading(false));
  }, [agentFingerprintHash, suiteVersion, canLoadFixture]);

  // ── Load fixture into form fields ───────────────────────────────────────────
  const handleLoadFixture = () => {
    if (!fixture) return;
    setResponses([...fixture.responses]);
    setStep(0);
    setFixtureBannerDismissed(true);
  };

  // ── Save fixture to server ──────────────────────────────────────────────────
  const handleSaveFixture = async (): Promise<boolean> => {
    if (!canSaveFixture) return true;
    setSaveStatus('saving');
    try {
      const suite = suiteVersion || REASONING_TEST_SUITE_V1.version;
      const res = await fetch(`${apiBaseUrl}/v1/fixtures/${encodeURIComponent(agentFingerprintHash!)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
        body: JSON.stringify({ agentName: agentName || null, suiteVersion: suite, responses }),
      });
      if (!res.ok) throw new Error('Save failed');
      const saved = await res.json();
      setFixture(saved);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
      return true;
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 2500);
      return false;
    }
  };

  // ── Save & Finalize (one click) ─────────────────────────────────────────────
  const handleSaveAndFinalize = async () => {
    await handleSaveFixture();
    onComplete(responses);
  };

  // ── Clear fixture ───────────────────────────────────────────────────────────
  const handleClearFixture = async () => {
    if (!canSaveFixture || !fixture) return;
    setClearStatus('clearing');
    try {
      const suite = suiteVersion || REASONING_TEST_SUITE_V1.version;
      await fetch(`${apiBaseUrl}/v1/fixtures/${encodeURIComponent(agentFingerprintHash!)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
        body: JSON.stringify({ suiteVersion: suite }),
      });
      setFixture(null);
      setClearStatus('cleared');
      setTimeout(() => setClearStatus('idle'), 2000);
    } catch {
      setClearStatus('idle');
    }
  };

  // ── Export fixture as JSON download ─────────────────────────────────────────
  const handleExportFixture = () => {
    if (!fixture) return;
    const filename = `fixture-${(agentName || 'agent').replace(/\s+/g, '-').toLowerCase()}-${new Date(fixture.savedAt).toISOString().slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(fixture, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Export current prompt responses as JSON download ────────────────────────
  const handleExportCurrentResponses = () => {
    const exportData = {
      fingerprintHash: agentFingerprintHash || 'custom-hash',
      agentName: agentName || 'custom-agent',
      suiteVersion: suiteVersion || REASONING_TEST_SUITE_V1.version,
      responses: responses,
      savedAt: new Date().toISOString(),
    };
    const filename = `fixture-${(agentName || 'agent').replace(/\s+/g, '-').toLowerCase()}-current-${new Date().toISOString().slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Import fixture file input trigger ────────────────────────────────────────
  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  // ── Handle file import change and validation ────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);
        
        let importedResponses: string[] = [];
        if (Array.isArray(parsed)) {
          importedResponses = parsed;
        } else if (parsed && Array.isArray(parsed.responses)) {
          importedResponses = parsed.responses;
        } else {
          throw new Error('Invalid fixture structure: missing "responses" array');
        }

        if (importedResponses.length !== prompts.length) {
          throw new Error(`Invalid response count: expected ${prompts.length}, got ${importedResponses.length}`);
        }

        if (!importedResponses.every(r => typeof r === 'string')) {
          throw new Error('All responses in the fixture must be strings');
        }

        setResponses(importedResponses);
        setStep(0);
        setImportError(null);

        // If the imported file has metadata, optionally set it as fixture
        if (parsed.savedAt && parsed.responses) {
          setFixture(parsed);
          setFixtureBannerDismissed(false);
        }
      } catch (err: any) {
        setImportError(err.message || 'Failed to parse JSON file');
      }
    };
    reader.onerror = () => {
      setImportError('Error reading file');
    };
    reader.readAsText(file);
    // Clear input value so selecting the same file again triggers change event
    e.target.value = '';
  };


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

  // ── Save status label helper ─────────────────────────────────────────────────
  const saveLabel = saveStatus === 'saving' ? '💾 Saving…'
    : saveStatus === 'saved' ? '✅ Saved!'
    : saveStatus === 'error' ? '❌ Save failed'
    : '💾 Save & Finalize';

  return (
    <div className="prompt-stepper">
      {/* Hidden file input for importing fixtures */}
      <input
        type="file"
        ref={fileInputRef}
        accept=".json"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {/* ── Import Error Banner ── */}
      {importError && (
        <div style={{
          marginBottom: '20px',
          padding: '14px 16px',
          background: 'rgba(239, 68, 68, 0.07)',
          border: '1px solid rgba(239, 68, 68, 0.25)',
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: 'var(--plasma-integrity-red)', fontSize: '1.1rem' }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--plasma-integrity-red)', marginBottom: '2px' }}>
                Import Failed
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--plasma-text-secondary)' }}>
                {importError}
              </div>
            </div>
          </div>
          <button
            onClick={() => setImportError(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--plasma-text-muted)',
              cursor: 'pointer',
              fontSize: '1.2rem',
              lineHeight: 1,
              padding: '0 4px',
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* ── Fixture Banner (baseline mode + fixture exists + not dismissed) ── */}
      {canLoadFixture && !fixtureLoading && fixture && !fixtureBannerDismissed && (
        <div style={{
          marginBottom: '20px',
          padding: '14px 16px',
          background: 'rgba(16, 185, 129, 0.07)',
          border: '1px solid rgba(16, 185, 129, 0.25)',
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: '1.1rem' }}>⚡</span>
          <div style={{ flex: 1, minWidth: '180px' }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--plasma-integrity-green)', marginBottom: '2px' }}>
              Saved fixture available
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--plasma-text-muted)' }}>
              {fixture.agentName || 'Agent'} · {fixture.suiteVersion} · saved {new Date(fixture.savedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={handleLoadFixture}
              className="primary-btn"
              style={{ padding: '6px 14px', fontSize: '0.8rem', fontWeight: 700 }}
            >
              Load Responses
            </button>
            <button
              onClick={handleExportFixture}
              className="secondary-btn"
              title="Export fixture as JSON"
              style={{ padding: '6px 10px', fontSize: '0.8rem' }}
            >
              📤
            </button>
            {canSaveFixture && (
              <button
                onClick={handleClearFixture}
                className="secondary-btn"
                title="Delete saved fixture"
                style={{ padding: '6px 10px', fontSize: '0.8rem', color: 'var(--plasma-warning-amber)' }}
                disabled={clearStatus === 'clearing'}
              >
                {clearStatus === 'clearing' ? '…' : clearStatus === 'cleared' ? '✓' : '🗑'}
              </button>
            )}
          </div>
        </div>
      )}



      {/* ── Header ── */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '10px',
          flexWrap: 'wrap',
          gap: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <span className="text-secondary" style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Prompt {step + 1} of {prompts.length}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={handleImportClick}
                className="secondary-btn"
                style={{
                  padding: '4px 10px',
                  fontSize: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontWeight: 600,
                }}
                disabled={disabled}
                title="Import responses from JSON file"
              >
                <span>📥</span> Import JSON
              </button>
              <button
                type="button"
                onClick={handleExportCurrentResponses}
                className="secondary-btn"
                style={{
                  padding: '4px 10px',
                  fontSize: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontWeight: 600,
                }}
                disabled={disabled}
                title="Export current responses to JSON file"
              >
                <span>📤</span> Export JSON
              </button>
            </div>
          </div>
          <span className="status-pill" style={{
            background: 'var(--plasma-surface)',
            border: '1px solid var(--plasma-border)',
            color: 'var(--plasma-text-muted)',
          }}>
            {currentPrompt.category.replace(/_/g, ' ')}
          </span>
        </div>

        {/* Progress bar */}
        <div style={{ height: '3px', background: 'var(--plasma-surface-2)', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${progress}%`,
            background: mode === 'baseline' ? 'var(--plasma-integrity-green)' : 'var(--plasma-clinical-blue)',
            borderRadius: '2px',
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      {/* ── Prompt display ── */}
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

      {/* ── Navigation ── */}
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
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
              {/* Primary action */}
              <button
                onClick={canSaveFixture ? handleSaveAndFinalize : () => onComplete(responses)}
                disabled={!allComplete || disabled || saveStatus === 'saving'}
                className="primary-btn"
                style={{
                  padding: '10px 28px',
                  fontWeight: 700,
                  background: mode === 'baseline' ? 'var(--plasma-integrity-green)' : undefined,
                  minWidth: '180px',
                }}
              >
                {canSaveFixture ? saveLabel : labels.finalize}
              </button>
              {/* Escape hatch: finalize without saving */}
              {canSaveFixture && (
                <button
                  onClick={() => onComplete(responses)}
                  disabled={!allComplete || disabled}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--plasma-text-muted)',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: '2px 4px',
                  }}
                >
                  Finalize without saving
                </button>
              )}
            </div>
          )}
        </div>
      </div>


    </div>
  );
};

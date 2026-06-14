import React, { useState, useEffect, useCallback } from 'react';
import { useBlockchain } from '../contexts/BlockchainContext';
import { PromptStepper, StepperMode } from './PromptStepper';
import { C2PAService } from '../services/c2pa.service';
import { downloadC2PAManifest, getVerificationFilename, getIdentityFilename } from '../utils/c2paExport.utils';
import {
  createManualResponseSet,
  generateBehavioralTraitHash,
  BehavioralHashResult,
  verifyBehavioralSignature,
} from '../utils/behavioral.utils';
import { REASONING_TEST_SUITE_V1 } from '../tests/behavioralTestSuite';
import { Agent } from '../types';

const c2paService = new C2PAService();
const REACT_APP_API_URL = process.env.REACT_APP_API_URL || '';
const REACT_APP_API_KEY = process.env.REACT_APP_API_KEY || '';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Phase =
  | 'select'      // Choose / enter an agent fingerprint
  | 'checking'    // Checking on-chain + sidecar for an existing baseline
  | 'ready'       // Baseline status resolved, show summary card
  | 'stepping'    // Running the 5-prompt stepper
  | 'result';     // Final result (commit success or audit score)

type StepperIntent = 'baseline' | 'audit';

interface BaselineStatus {
  exists: boolean;
  hash?: string;
  version?: string;
  lastUpdatedAt?: string | null;
}

interface AgentListItem {
  fingerprintHash: string;
  name: string;
  provider: string;
  isRevoked: boolean;
  hasBehavioralTrait: boolean;
  hasFixture?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const BehaviorAuditView: React.FC = () => {
  const { service, isConnected, isSandbox } = useBlockchain();

  // Phase state machine
  const [phase, setPhase] = useState<Phase>('select');

  // Agent selection
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [selectedHash, setSelectedHash] = useState('');
  const [manualHash, setManualHash] = useState('');
  const [useManual, setUseManual] = useState(false);

  // Baseline check
  const [baselineStatus, setBaselineStatus] = useState<BaselineStatus | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  // Stepper intent determines which flow runs after stepping
  const [stepperIntent, setStepperIntent] = useState<StepperIntent>('audit');

  // Post-stepper results
  const [hashResult, setHashResult] = useState<BehavioralHashResult | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitSuccess, setCommitSuccess] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<any | null>(null);
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Re-baseline confirmation REPLACE modal
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [replaceConfirmText, setReplaceConfirmText] = useState('');

  // Resolved fingerprint (from dropdown or manual entry)
  const activeHash = useManual ? manualHash.trim() : selectedHash;

  // ---------------------------------------------------------------------------
  // Load agent list
  // ---------------------------------------------------------------------------

  const fetchAgents = useCallback(async () => {
    setAgentsLoading(true);
    try {
      // 1. Try to load from blockchain/sandbox service first
      if (service) {
        try {
          const list = await service.getRegisteredAgents();
          if (list && list.length > 0) {
            const mappedList: AgentListItem[] = list
              .filter(a => !a.revoked)
              .map(a => ({
                fingerprintHash: a.fingerprintHash,
                name: a.name,
                provider: a.provider,
                isRevoked: !!a.revoked,
                hasBehavioralTrait: !!a.behavioralTraitHash
              }));
            setAgents(mappedList);
            // Pre-select first if available and nothing already chosen
            if (mappedList.length > 0 && !selectedHash) {
              setSelectedHash(mappedList[0].fingerprintHash);
            }
            setAgentsLoading(false);
            return;
          }
        } catch (serviceErr) {
          console.warn('Failed to load agents from blockchain service, falling back to API:', serviceErr);
        }
      }

      // 2. Fallback to backend API database
      const res = await fetch(`${REACT_APP_API_URL}/v1/agents?limit=50`, {
        headers: { Authorization: `Bearer ${REACT_APP_API_KEY}` },
      });
      const data = await res.json();
      if (data.data) {
        const list: AgentListItem[] = data.data
          .filter((a: any) => !a.revoked)
          .map((a: any) => ({
            fingerprintHash: a.fingerprintHash,
            name: a.name,
            provider: a.provider,
            isRevoked: !!a.revoked,
            hasBehavioralTrait: !!a.behavioralTraitHash || !!a.hasFixture,
          }));
        setAgents(list);
        // Pre-select first if available and nothing already chosen
        if (list.length > 0 && !selectedHash) {
          setSelectedHash(list[0].fingerprintHash);
        }
      }
    } catch (err) {
      console.warn('Failed to load agents for dropdown:', err);
    } finally {
      setAgentsLoading(false);
    }
  }, [selectedHash, service]);



  // ---------------------------------------------------------------------------
  // Check baseline
  // ---------------------------------------------------------------------------

  const checkBaseline = useCallback(async (hash: string) => {
    setPhase('checking');
    setCheckError(null);
    setBaselineStatus(null);

    try {
      // 1. On-chain check via blockchain service
      let onChain: BaselineStatus = { exists: false };
      if (service) {
        try {
          const data = await service.contract.getBehavioralTraitData(hash);
          if (data && data[0]) {
            onChain = {
              exists: true,
              hash: data[1],
              version: data[2],
              lastUpdatedAt: null,
            };
          }
        } catch (chainErr) {
          console.warn('On-chain baseline check failed, falling back to sidecar:', chainErr);
        }
      }

      // 2. Off-chain sidecar fallback (localStorage)
      const sidecar = localStorage.getItem(`sidecar_${hash}`);
      const hasSidecar = !!sidecar;

      // Merge: either source confirms a baseline exists
      const status: BaselineStatus = onChain.exists
        ? onChain
        : hasSidecar
        ? { exists: true, hash: undefined, version: undefined, lastUpdatedAt: undefined }
        : { exists: false };

      // 3. Enrich with API agent data (has timestamp)
      try {
        const res = await fetch(`${REACT_APP_API_URL}/v1/agents/${encodeURIComponent(hash)}`, {
          headers: { Authorization: `Bearer ${REACT_APP_API_KEY}` },
        });
        if (res.ok) {
          const agentData = await res.json();
          if (agentData.behavioralTrait?.hasTrait) {
            status.exists = true;
            status.hash = status.hash || agentData.behavioralTrait.latestTraitHash;
            status.version = status.version || agentData.behavioralTrait.traitVersion;
            status.lastUpdatedAt = agentData.behavioralTrait.lastUpdatedAt;
          }
        }
      } catch (apiErr) {
        // Non-fatal — we have the on-chain/sidecar result already
      }

      setBaselineStatus(status);
      setPhase('ready');
    } catch (err: any) {
      setCheckError(err.message || 'Failed to check baseline status.');
      setPhase('select');
    }
  }, [service]);

  useEffect(() => {
    fetchAgents();
    
    // Check if there is a pending fingerprint hash to audit from governance
    const pendingHash = sessionStorage.getItem('pending_behavior_audit_hash');
    if (pendingHash) {
      sessionStorage.removeItem('pending_behavior_audit_hash');
      setSelectedHash(pendingHash);
      // Automatically trigger the baseline check
      checkBaseline(pendingHash);
    }
  }, [fetchAgents, checkBaseline]);

  // ---------------------------------------------------------------------------
  // Post-stepper handlers
  // ---------------------------------------------------------------------------

  const handleStepperComplete = (responses: string[]) => {
    const responseSet = createManualResponseSet(REASONING_TEST_SUITE_V1, responses);
    const result = generateBehavioralTraitHash(responseSet);
    setHashResult(result);

    if (stepperIntent === 'baseline') {
      setPhase('result');
    } else {
      runAudit(result);
    }
  };

  const runAudit = async (result: BehavioralHashResult) => {
    setIsAuditing(true);
    setAuditError(null);
    setPhase('result');

    try {
      if (isSandbox) {
        // Load the baseline responses from localStorage
        const baselineStr = localStorage.getItem(`sidecar_${activeHash}`);
        if (!baselineStr) {
          throw new Error('Baseline responses not found. Please register a baseline first.');
        }

        const baselineResponses = JSON.parse(baselineStr);
        const verification = verifyBehavioralSignature(
          baselineResponses,
          result.responseSet,
          'triage'
        );

        let trust_score = 100;
        let decision = 'accept';
        const signals: string[] = ['contract_status_active'];
        const recommendations: string[] = [];

        if (verification.match) {
          if (verification.perturbation.suspicious) {
            signals.push('suspicious_perturbations_detected');
            trust_score = 0;
            decision = 'deny';
            recommendations.push('Hard reject: Probable homograph injection or evasion assault.');
          } else {
            signals.push('behavioral_match_success');
            trust_score = 100;
          }
        } else {
          signals.push('behavioral_mismatch');
          if (verification.perturbation.suspicious) {
            signals.push('suspicious_perturbations_detected');
            trust_score = 0;
            decision = 'deny';
            recommendations.push('Hard reject: Probable homograph injection or evasion assault.');
          } else {
            trust_score = Math.floor(verification.similarity * 100);
            decision = 'challenge';
            recommendations.push('Similarity score too low. Possible model substitution.');
          }
        }

        // Get the agent profile info
        const agentName = agents.find(a => a.fingerprintHash === activeHash)?.name || 'Unknown Agent';
        const agentProvider = agents.find(a => a.fingerprintHash === activeHash)?.provider || 'Unknown Provider';

        const auditResponse = {
          decision,
          trust_score,
          agent: {
            fingerprintHash: activeHash,
            name: agentName,
            provider: agentProvider,
            isRevoked: false,
          },
          signals,
          indexer: { isStale: false, lagBlocks: 0 },
          recommendations,
          verification_details: { similarity_score: verification.similarity }
        };

        setAuditResult(auditResponse);
        return;
      }

      // Live mode fallback: query the API endpoint
      const res = await fetch(`${REACT_APP_API_URL}/v1/agents/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${REACT_APP_API_KEY}`,
        },
        body: JSON.stringify({
          fingerprintHash: activeHash,
          currentResponseSet: result.responseSet,
        }),
      });

      if (!res.ok) throw new Error(`Gateway error: ${res.statusText}`);
      const data = await res.json();
      setAuditResult(data);
    } catch (err: any) {
      setAuditError(err.message || 'Audit request failed.');
    } finally {
      setIsAuditing(false);
    }
  };

  const handleCommitBaseline = async () => {
    if (!service || !hashResult) return;
    setIsCommitting(true);
    setCommitError(null);

    try {
      await c2paService.initializeIdentity(activeHash);

      // ── Step 0: Ensure the fingerprint is registered on-chain first ──────
      // The contract enforces: registerFingerprint() must precede registerBehavioralTrait().
      // Agents loaded from the DB cache may not be on-chain yet, so we check and
      // auto-register if necessary before attempting to commit the baseline.
      if (!isSandbox) {
        let isOnChain = false;
        try {
          const onChainAgent = await service.verifyFingerprint(activeHash);
          isOnChain = onChainAgent !== null;
        } catch (checkErr) {
          console.warn('Could not verify on-chain registration, will attempt to register:', checkErr);
        }

        if (!isOnChain) {
          // Resolve agent metadata from the loaded dropdown list
          const agentMeta = agents.find(a => a.fingerprintHash === activeHash);
          if (!agentMeta) {
            throw new Error(
              'This fingerprint is not registered on-chain and its metadata could not be found. ' +
              'Please register the agent via Agent Governance → Register New Agent first.'
            );
          }

          console.log('Fingerprint not on-chain — auto-registering before baseline commit...');
          await service.registerFingerprint({
            id: activeHash,            // use the hash as the canonical ID
            name: agentMeta.name,
            provider: agentMeta.provider,
            version: hashResult.traitVersion,
            fingerprintHash: activeHash,
          });
          console.log('Fingerprint registered on-chain successfully.');
        }
      }

      const result = await service.registerBehavioralTrait(
        activeHash,
        hashResult.hash,
        hashResult.traitVersion
      );

      if (result.success) {
        localStorage.setItem(`sidecar_${activeHash}`, JSON.stringify(hashResult.responseSet));

        // Seed Redis off-chain cache
        try {
          await fetch(`${REACT_APP_API_URL}/v1/internal/traits/seed`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${REACT_APP_API_KEY}`,
            },
            body: JSON.stringify({
              fingerprintHash: activeHash,
              responseSet: hashResult.responseSet,
            }),
          });
        } catch (cacheErr) {
          console.warn('Failed to sync baseline to Redis cache:', cacheErr);
        }

        // If it was a re-baseline, log to the clinical event ledger!
        if (baselineStatus?.exists) {
          try {
            await fetch(`${REACT_APP_API_URL}/v1/events`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${REACT_APP_API_KEY}`,
              },
              body: JSON.stringify({
                agent_fingerprint_id: activeHash,
                model_version: hashResult.traitVersion,
                workflow_type: 'behavior_rebaseline',
                clinician_action: 'rebaselined',
                input_ref: `sha256://${hashResult.hash}`,
                output_ref: `sha256://${hashResult.hash}`,
                clinical_data: {
                  previousBaselineHash: baselineStatus.hash || 'unknown',
                  newBaselineHash: hashResult.hash,
                  version: hashResult.traitVersion,
                  timestamp: new Date().toISOString()
                }
              }),
            });
          } catch (eventErr) {
            console.warn('Failed to log re-baseline event:', eventErr);
          }
        }

        setCommitSuccess(true);
        // Refresh agent list so hasBehavioralTrait updates in dropdown
        fetchAgents();
      }
    } catch (err: any) {
      setCommitError(`Commit failed: ${err.message}`);
    } finally {
      setIsCommitting(false);
    }
  };

  const handleDownloadIdentity = async () => {
    try {
      const agent: Omit<Agent, 'createdAt'> = {
        id: activeHash,
        name: agents.find(a => a.fingerprintHash === activeHash)?.name || 'Verified Agent',
        provider: 'Identity Layer',
        version: hashResult?.traitVersion || 'v1.0',
        fingerprintHash: activeHash,
      };
      const manifest = await c2paService.generateIdentityManifest(agent as any);
      downloadC2PAManifest(manifest, getIdentityFilename(activeHash));
    } catch (err: any) {
      setCommitError(`Export failed: ${err.message}`);
    }
  };

  const handleDownloadCert = async () => {
    if (!auditResult) return;
    setExportStatus(null);
    try {
      const verificationResult = {
        match: auditResult.decision === 'accept',
        similarity: auditResult.verification_details?.similarity_score || 0,
        confidence: (auditResult.trust_score || 0) / 100,
        mode: 'enforcement' as const,
        perturbation: {
          perturbationScore: auditResult.verification_details?.perturbation_score || 0,
          suspicious: auditResult.signals?.includes('suspicious_perturbations_detected') || false,
          editDistance: auditResult.verification_details?.perturbation_score || 0,
          hasEncodingArtifacts: auditResult.signals?.includes('encoding_artifacts_detected') || false,
          hasHomographs: auditResult.signals?.includes('homoglyph_spoofing_detected') || false,
          hasInvisibleChars: auditResult.signals?.includes('invisible_chars_detected') || false,
          flags: auditResult.signals || [],
        },
        decision: {
          reason: auditResult.recommendations?.[0] || 'Verification completed',
          threshold: 0.95,
        },
        traitVersion: REASONING_TEST_SUITE_V1.version,
      };
      const manifest = await c2paService.generateVerificationManifest(activeHash, verificationResult);
      downloadC2PAManifest(manifest, getVerificationFilename(activeHash));
      setExportStatus({ type: 'success', message: 'Audit Certificate exported.' });
      setTimeout(() => setExportStatus(null), 3000);
    } catch (err: any) {
      setExportStatus({ type: 'error', message: `Export failed: ${err.message}` });
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // ---------------------------------------------------------------------------
  // Reset to a clean state
  // ---------------------------------------------------------------------------

  const resetAll = () => {
    setPhase('select');
    setBaselineStatus(null);
    setCheckError(null);
    setHashResult(null);
    setAuditResult(null);
    setAuditError(null);
    setCommitSuccess(false);
    setCommitError(null);
    setExportStatus(null);
    setIsAuditing(false);
    setIsCommitting(false);
  };

  // ---------------------------------------------------------------------------
  // Guard: wallet not connected
  // ---------------------------------------------------------------------------

  if (!isConnected) {
    return (
      <div className="plasma-card" style={{ textAlign: 'center', padding: '48px' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>🔐</div>
        <h3 className="text-error">Clinical Access Required</h3>
        <p className="text-secondary" style={{ marginTop: '8px' }}>
          Connect your provider wallet to access the Behavioral Audit workflow.
        </p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const selectedAgent = agents.find(a => a.fingerprintHash === activeHash);

  return (
    <div className="behavior-audit-view">
      {/* ── View header ── */}
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--plasma-text-primary)', marginBottom: '6px' }}>
          Behavioral Baseline & Drift Audit
        </h2>
        <p className="text-secondary" style={{ fontSize: '0.9rem', maxWidth: '700px' }}>
          Select an agent, verify its registered baseline, and run a safety-grade drift audit — all in a single guided workflow.
        </p>
      </div>

      {/* ── Breadcrumb / phase indicator ── */}
      <BreadcrumbTrail phase={phase} intent={stepperIntent} />

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PHASE: select                                                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {phase === 'select' && (
        <div className="plasma-card" style={{ maxWidth: '640px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '24px', color: 'var(--plasma-text-primary)' }}>
            Select Agent
          </h3>

          {/* Dropdown */}
          {!useManual && (
            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label className="text-muted" style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: '10px', display: 'block' }}>
                Registered Agent
              </label>
              {agentsLoading ? (
                <div className="text-muted" style={{ fontSize: '0.85rem', padding: '10px 0' }}>Loading registry…</div>
              ) : agents.length === 0 ? (
                <div className="text-muted" style={{ fontSize: '0.85rem', padding: '10px 0' }}>
                  No registered agents found. Switch to manual entry below.
                </div>
              ) : (
                <select
                  value={selectedHash}
                  onChange={e => setSelectedHash(e.target.value)}
                  className="form-input"
                  style={{ background: 'var(--plasma-surface-2)' }}
                >
                  {agents.map(a => (
                    <option key={a.fingerprintHash} value={a.fingerprintHash}>
                      {a.name} — {a.fingerprintHash.slice(0, 14)}…
                      {a.hasBehavioralTrait ? ' ✓' : ' (no baseline)'}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Manual entry toggle */}
          {useManual ? (
            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label className="text-muted" style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: '10px', display: 'block' }}>
                Fingerprint Hash
              </label>
              <input
                type="text"
                placeholder="0x…"
                value={manualHash}
                onChange={e => setManualHash(e.target.value)}
                className="form-input"
                style={{ fontFamily: 'monospace', fontSize: '0.88rem' }}
              />
              <button
                onClick={() => { setUseManual(false); setManualHash(''); }}
                style={{ marginTop: '10px', background: 'none', border: 'none', color: 'var(--plasma-clinical-blue)', cursor: 'pointer', fontSize: '0.82rem' }}
              >
                ← Back to registry
              </button>
            </div>
          ) : (
            <button
              onClick={() => setUseManual(true)}
              style={{ background: 'none', border: 'none', color: 'var(--plasma-clinical-blue)', cursor: 'pointer', fontSize: '0.82rem', marginBottom: '24px', padding: 0 }}
            >
              Enter hash manually →
            </button>
          )}

          {/* Errors */}
          {checkError && (
            <p className="text-error" style={{ fontSize: '0.85rem', marginBottom: '16px' }}>{checkError}</p>
          )}

          <button
            onClick={() => checkBaseline(activeHash)}
            disabled={!activeHash}
            className="primary-btn"
            style={{ width: '100%', padding: '14px', fontWeight: 700 }}
          >
            Load Agent →
          </button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PHASE: checking                                                     */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {phase === 'checking' && (
        <div className="plasma-card" style={{ maxWidth: '640px', textAlign: 'center', padding: '48px' }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '50%',
            border: '3px solid var(--plasma-clinical-blue)',
            borderTopColor: 'transparent',
            animation: 'spin 0.9s linear infinite',
            margin: '0 auto 20px',
          }} />
          <p className="text-secondary" style={{ fontSize: '0.9rem' }}>
            Checking blockchain for registered baseline…
          </p>
          <code className="text-muted" style={{ fontSize: '0.75rem', marginTop: '8px', display: 'block', wordBreak: 'break-all' }}>
            {activeHash}
          </code>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PHASE: ready                                                        */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {phase === 'ready' && baselineStatus && (
        <div style={{ maxWidth: '640px' }}>
          {/* Agent identity strip */}
          <div style={{
            padding: '14px 18px',
            background: 'var(--plasma-surface-2)',
            borderRadius: '8px',
            border: '1px solid var(--plasma-border)',
            marginBottom: '20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
          }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--plasma-text-primary)' }}>
                {selectedAgent?.name || 'Agent'}
              </div>
              <code className="text-muted" style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>
                {activeHash}
              </code>
            </div>
            <button
              onClick={resetAll}
              style={{ background: 'none', border: 'none', color: 'var(--plasma-clinical-blue)', cursor: 'pointer', fontSize: '0.82rem' }}
            >
              ← Change agent
            </button>
          </div>

          {/* Baseline status card */}
          {baselineStatus.exists ? (
            <div className="plasma-card" style={{
              border: '1px solid rgba(16, 185, 129, 0.25)',
              background: 'rgba(16, 185, 129, 0.04)',
              marginBottom: '20px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                <span style={{ fontSize: '1.3rem' }}>✅</span>
                <h3 style={{ margin: 0, color: 'var(--plasma-integrity-green)', fontSize: '1rem', fontWeight: 700 }}>
                  Behavioral Baseline on Record
                </h3>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                {baselineStatus.hash && (
                  <div>
                    <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', marginBottom: '4px' }}>Trait Hash</div>
                    <code style={{ fontSize: '0.78rem', color: 'var(--plasma-text-secondary)', wordBreak: 'break-all' }}>
                      {baselineStatus.hash.slice(0, 18)}…
                    </code>
                  </div>
                )}
                {baselineStatus.version && (
                  <div>
                    <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', marginBottom: '4px' }}>Suite Version</div>
                    <span style={{ fontSize: '0.85rem', color: 'var(--plasma-text-primary)' }}>{baselineStatus.version}</span>
                  </div>
                )}
                {baselineStatus.lastUpdatedAt && (
                  <div style={{ gridColumn: '1/-1' }}>
                    <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', marginBottom: '4px' }}>Last Registered</div>
                    <span style={{ fontSize: '0.85rem', color: 'var(--plasma-text-secondary)' }}>
                      {new Date(baselineStatus.lastUpdatedAt).toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                    </span>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={() => { setStepperIntent('audit'); setPhase('stepping'); }}
                  className="primary-btn"
                  style={{ flex: 2, padding: '13px', fontWeight: 700 }}
                >
                  Run Drift Audit →
                </button>
                <button
                  onClick={() => { setStepperIntent('baseline'); setPhase('stepping'); }}
                  className="secondary-btn"
                  style={{ flex: 1, padding: '13px', fontSize: '0.85rem' }}
                >
                  Re-baseline
                </button>
              </div>
            </div>
          ) : (
            <div className="plasma-card" style={{
              border: '1px solid rgba(245, 158, 11, 0.25)',
              background: 'rgba(245, 158, 11, 0.04)',
              marginBottom: '20px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <span style={{ fontSize: '1.3rem' }}>⚠️</span>
                <h3 style={{ margin: 0, color: 'var(--plasma-warning-amber)', fontSize: '1rem', fontWeight: 700 }}>
                  No Baseline Registered
                </h3>
              </div>
              <p className="text-secondary" style={{ fontSize: '0.88rem', lineHeight: '1.6', marginBottom: '20px' }}>
                This agent has no behavioral baseline on the blockchain ledger. Complete the 5-prompt test suite to establish one before drift audits are possible.
              </p>
              <button
                onClick={() => { setStepperIntent('baseline'); setPhase('stepping'); }}
                className="primary-btn"
                style={{ width: '100%', padding: '13px', fontWeight: 700, background: 'var(--plasma-warning-amber)', color: '#000' }}
              >
                Establish Baseline →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PHASE: stepping                                                     */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {phase === 'stepping' && (
        <div style={{ maxWidth: '680px' }}>
          {/* Context pill above stepper */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '20px',
            padding: '10px 14px',
            background: 'var(--plasma-surface-2)',
            borderRadius: '8px',
            border: '1px solid var(--plasma-border)',
          }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--plasma-text-muted)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span>{stepperIntent === 'baseline' ? '🛡️ Establishing baseline for' : '🔍 Auditing drift for'}</span>
              {selectedAgent && (
                <strong style={{ color: 'var(--plasma-text-primary)', fontWeight: 700 }}>
                  {selectedAgent.name}
                </strong>
              )}
            </span>
            <code style={{ fontSize: '0.78rem', color: 'var(--plasma-clinical-blue)' }}>
              {selectedAgent ? `(${activeHash.slice(0, 18)}…)` : activeHash}
            </code>
          </div>

          <PromptStepper
            mode={stepperIntent as StepperMode}
            onComplete={handleStepperComplete}
            onCancel={() => setPhase('ready')}
            agentFingerprintHash={activeHash}
            agentName={selectedAgent?.name}
            suiteVersion={REASONING_TEST_SUITE_V1.version}
            apiBaseUrl={REACT_APP_API_URL}
            apiToken={REACT_APP_API_KEY}
          />
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PHASE: result — baseline commit                                     */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {phase === 'result' && stepperIntent === 'baseline' && hashResult && (
        <div style={{ maxWidth: '640px' }}>
          {commitSuccess ? (
            <div className="plasma-card" style={{ border: '2px solid var(--plasma-integrity-green)' }}>
              <h3 style={{ color: 'var(--plasma-integrity-green)', marginBottom: '20px' }}>
                ✅ Behavioral Baseline Committed
              </h3>

              <div style={{ padding: '16px', background: 'var(--plasma-surface-2)', borderRadius: '8px', marginBottom: '24px' }}>
                <div style={{ marginBottom: '10px' }}>
                  <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', marginBottom: '4px' }}>Trait Hash</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <code style={{ fontSize: '0.82rem', color: 'var(--plasma-text-secondary)', wordBreak: 'break-all', flex: 1 }}>
                      {hashResult.hash}
                    </code>
                    <button onClick={() => copyToClipboard(hashResult.hash, 'trait')} className="icon-btn">
                      {copiedField === 'trait' ? '✓' : '📋'}
                    </button>
                  </div>
                </div>
                <div>
                  <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', marginBottom: '4px' }}>Suite Version</div>
                  <span style={{ fontSize: '0.85rem' }}>{hashResult.traitVersion}</span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button onClick={handleDownloadIdentity} className="primary-btn" style={{ flex: 1, padding: '13px' }}>
                  📥 Export Identity Manifest
                </button>
                <button
                  onClick={() => { resetAll(); checkBaseline(activeHash); }}
                  className="secondary-btn"
                  style={{ flex: 1, padding: '13px' }}
                >
                  Run Audit Now
                </button>
              </div>
            </div>
          ) : (
            <div className="plasma-card">
              <h3 style={{ marginBottom: '20px', color: 'var(--plasma-text-primary)', fontSize: '1rem', fontWeight: 600 }}>
                Confirm Baseline Commit
              </h3>

              <div style={{ padding: '16px', background: 'rgba(79, 131, 255, 0.05)', borderRadius: '8px', border: '1px solid var(--plasma-clinical-blue)', marginBottom: '24px' }}>
                <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', marginBottom: '8px' }}>Computed Baseline Hash</div>
                <code style={{ fontSize: '0.88rem', wordBreak: 'break-all', color: 'var(--plasma-text-primary)' }}>
                  {hashResult.hash}
                </code>
                <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: '8px' }}>
                  Version: {hashResult.traitVersion}
                </div>
              </div>

              {commitError && (
                <p className="text-error" style={{ fontSize: '0.85rem', marginBottom: '16px' }}>{commitError}</p>
              )}

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={() => setPhase('stepping')}
                  className="secondary-btn"
                  style={{ padding: '13px 20px' }}
                  disabled={isCommitting}
                >
                  ← Edit Responses
                </button>
                <button
                  onClick={() => {
                    if (baselineStatus?.exists) {
                      setShowReplaceModal(true);
                      setReplaceConfirmText('');
                    } else {
                      handleCommitBaseline();
                    }
                  }}
                  className="primary-btn"
                  style={{ flex: 1, padding: '13px', fontWeight: 700 }}
                  disabled={isCommitting}
                >
                  {isCommitting ? 'Committing to Ledger…' : 'Commit Baseline to Ledger'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PHASE: result — audit score                                         */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {phase === 'result' && stepperIntent === 'audit' && (
        <div style={{ maxWidth: '680px' }}>
          {isAuditing && (
            <div className="plasma-card" style={{ textAlign: 'center', padding: '48px' }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '50%',
                border: '3px solid var(--plasma-clinical-blue)',
                borderTopColor: 'transparent',
                animation: 'spin 0.9s linear infinite',
                margin: '0 auto 20px',
              }} />
              <p className="text-secondary">Running safety-grade behavioral audit…</p>
            </div>
          )}

          {auditError && !isAuditing && (
            <div className="plasma-card" style={{ border: '1px solid var(--plasma-integrity-red)', background: 'rgba(239,68,68,0.05)' }}>
              <p className="text-error" style={{ margin: 0 }}>⚠️ {auditError}</p>
              <button onClick={() => runAudit(hashResult!)} className="secondary-btn" style={{ marginTop: '16px' }}>
                Retry Audit
              </button>
            </div>
          )}

          {auditResult && !isAuditing && (
            <div>
              <div className="plasma-card" style={{
                border: `2px solid ${auditResult.decision === 'accept' ? 'var(--plasma-integrity-green)' : 'var(--plasma-warning-amber)'}`,
                marginBottom: '16px',
              }}>
                {/* Result headline */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '8px' }}>
                  <h3 style={{
                    margin: 0,
                    color: auditResult.decision === 'accept' ? 'var(--plasma-integrity-green)' : 'var(--plasma-warning-amber)',
                    fontSize: '1rem',
                  }}>
                    {auditResult.decision === 'accept'
                      ? '✅ Audit Passed: Baseline Consistent'
                      : '⚠️ Audit Warning: Behavioral Drift Detected'}
                  </h3>
                  <div className="text-muted" style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <code>{activeHash.slice(0, 12)}…</code>
                    <button onClick={() => copyToClipboard(activeHash, 'hash')} className="icon-btn">
                      {copiedField === 'hash' ? '✓' : '📋'}
                    </button>
                  </div>
                </div>

                {/* Score tiles */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                  <div style={{ padding: '18px', background: 'var(--plasma-surface-2)', borderRadius: '8px', textAlign: 'center', border: '1px solid var(--plasma-border)' }}>
                    <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', marginBottom: '6px' }}>Stability Match</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--plasma-text-primary)' }}>
                      {((auditResult.verification_details?.similarity_score || 0) * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div style={{ padding: '18px', background: 'rgba(79, 131, 255, 0.05)', borderRadius: '8px', textAlign: 'center', border: '2px solid var(--plasma-clinical-blue)' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--plasma-clinical-blue)', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 700 }}>Integrity Score</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--plasma-text-primary)' }}>
                      {auditResult.trust_score}<span style={{ fontSize: '0.9rem', opacity: 0.5 }}> / 100</span>
                    </div>
                  </div>
                </div>

                {/* Signals */}
                {auditResult.signals?.length > 0 && (
                  <div style={{ padding: '16px', background: 'var(--plasma-surface-2)', borderRadius: '8px', marginBottom: '20px' }}>
                    <h4 className="text-secondary" style={{ margin: '0 0 12px 0', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Behavioral Signals
                    </h4>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {auditResult.signals.map((signal: string, i: number) => (
                        <span key={i} className="status-pill" style={{
                          background: 'rgba(16, 185, 129, 0.1)',
                          color: 'var(--plasma-integrity-green)',
                          border: '1px solid rgba(16, 185, 129, 0.2)',
                          fontSize: '0.72rem',
                        }}>
                          🛡️ {signal.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommendations */}
                {auditResult.recommendations?.length > 0 && (
                  <div style={{ padding: '16px', background: 'rgba(245, 158, 11, 0.05)', borderRadius: '8px', marginBottom: '20px', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                    <strong style={{ color: 'var(--plasma-warning-amber)', display: 'block', marginBottom: '8px', fontSize: '0.88rem' }}>
                      🛡️ Clinical Recommendations
                    </strong>
                    <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--plasma-text-secondary)', fontSize: '0.88rem', lineHeight: '1.6' }}>
                      {auditResult.recommendations.map((rec: string, i: number) => (
                        <li key={i}>{rec}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Export status */}
                {exportStatus && (
                  <div style={{
                    padding: '10px',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    textAlign: 'center',
                    marginBottom: '16px',
                    background: exportStatus.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                    color: exportStatus.type === 'success' ? 'var(--plasma-integrity-green)' : 'var(--plasma-integrity-red)',
                    border: `1px solid ${exportStatus.type === 'success' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
                  }}>
                    {exportStatus.type === 'success' ? '✅' : '❌'} {exportStatus.message}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button onClick={resetAll} className="secondary-btn" style={{ flex: 1, padding: '13px' }}>
                    New Audit
                  </button>
                  <button onClick={handleDownloadCert} className="primary-btn" style={{ flex: 1, padding: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    🛡️ Export Audit Cert
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Re-baseline Confirmation REPLACE Modal ── */}
      {showReplaceModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 19, 32, 0.85)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
          padding: '20px',
        }}>
          <div className="plasma-card" style={{
            maxWidth: '500px',
            width: '100%',
            border: '1px solid var(--plasma-warning-amber)',
            boxShadow: '0 8px 32px rgba(245, 158, 11, 0.15)',
            background: 'var(--plasma-surface)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <span style={{ fontSize: '1.8rem' }}>⚠️</span>
              <h3 style={{ margin: 0, color: 'var(--plasma-warning-amber)', fontSize: '1.2rem', fontWeight: 700 }}>
                CRITICAL: Replace Behavioral Baseline
              </h3>
            </div>
            
            <p className="text-secondary" style={{ fontSize: '0.9rem', lineHeight: '1.6', marginBottom: '20px' }}>
              You are about to overwrite the registered behavioral baseline for this agent. This will **permanently change the ground truth** used for all future drift audits. This critical clinical safety action will be logged on the blockchain ledger and the audit dashboard.
            </p>

            <div style={{
              background: 'var(--plasma-surface-2)',
              border: '1px solid var(--plasma-border)',
              padding: '12px 16px',
              borderRadius: '6px',
              marginBottom: '20px',
            }}>
              <span className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Agent to Re-Baseline</span>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--plasma-text-primary)' }}>
                {selectedAgent?.name || 'Agent'}
              </div>
              <code style={{ fontSize: '0.78rem', color: 'var(--plasma-clinical-blue)', wordBreak: 'break-all' }}>
                {activeHash}
              </code>
            </div>

            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label htmlFor="replace-confirm" style={{ color: 'var(--plasma-text-secondary)', fontWeight: 600, fontSize: '0.82rem', marginBottom: '8px', display: 'block' }}>
                To authorize, please type <strong style={{ color: 'var(--plasma-warning-amber)' }}>REPLACE</strong> in all caps below:
              </label>
              <input
                id="replace-confirm"
                type="text"
                value={replaceConfirmText}
                onChange={e => setReplaceConfirmText(e.target.value)}
                placeholder="REPLACE"
                className="form-input"
                style={{
                  border: replaceConfirmText === 'REPLACE' ? '1px solid var(--plasma-integrity-green)' : '1px solid var(--plasma-border)',
                  color: '#fff',
                  fontFamily: 'monospace',
                  letterSpacing: '2px',
                  fontWeight: 700,
                  textAlign: 'center',
                }}
                autoFocus
              />
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => {
                  setShowReplaceModal(false);
                  setReplaceConfirmText('');
                }}
                className="secondary-btn"
                style={{ flex: 1, padding: '12px' }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowReplaceModal(false);
                  setReplaceConfirmText('');
                  handleCommitBaseline();
                }}
                disabled={replaceConfirmText !== 'REPLACE'}
                className="primary-btn"
                style={{
                  flex: 1,
                  padding: '12px',
                  background: 'var(--plasma-warning-amber)',
                  color: '#000',
                  fontWeight: 700,
                }}
              >
                Confirm & Overwrite
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Breadcrumb trail
// ---------------------------------------------------------------------------

const STEPS: Array<{ key: Phase | Phase[]; label: string }> = [
  { key: 'select', label: 'Select Agent' },
  { key: ['checking', 'ready'], label: 'Baseline Status' },
  { key: 'stepping', label: 'Prompt Suite' },
  { key: 'result', label: 'Result' },
];

const BreadcrumbTrail: React.FC<{ phase: Phase; intent: StepperIntent }> = ({ phase, intent }) => {
  const activeIdx = STEPS.findIndex(s =>
    Array.isArray(s.key) ? s.key.includes(phase) : s.key === phase
  );

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      marginBottom: '28px',
      flexWrap: 'wrap',
    }}>
      {STEPS.map((s, i) => {
        const done = i < activeIdx;
        const active = i === activeIdx;
        return (
          <React.Fragment key={i}>
            <span style={{
              fontSize: '0.78rem',
              fontWeight: active ? 700 : 500,
              padding: '4px 10px',
              borderRadius: '20px',
              background: active
                ? (intent === 'baseline' ? 'rgba(16,185,129,0.12)' : 'rgba(79,131,255,0.12)')
                : done
                ? 'rgba(255,255,255,0.04)'
                : 'transparent',
              color: active
                ? (intent === 'baseline' ? 'var(--plasma-integrity-green)' : 'var(--plasma-clinical-blue)')
                : done
                ? 'var(--plasma-text-secondary)'
                : 'var(--plasma-text-muted)',
              border: active
                ? `1px solid ${intent === 'baseline' ? 'rgba(16,185,129,0.3)' : 'rgba(79,131,255,0.3)'}`
                : '1px solid transparent',
              transition: 'all 0.2s ease',
            }}>
              {done ? '✓ ' : ''}{s.label}
            </span>
            {i < STEPS.length - 1 && (
              <span className="text-muted" style={{ fontSize: '0.7rem' }}>›</span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

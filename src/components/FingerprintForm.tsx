import React, { useState } from 'react';
import { Agent } from '../types';
import { isValidFingerprintFormat } from '../utils/fingerprint.utils';
import { useBlockchain } from '../contexts/BlockchainContext';

interface FingerprintFormProps {
    onSuccess: (agent: Omit<Agent, 'createdAt'>) => void;
}

const FingerprintForm: React.FC<FingerprintFormProps> = ({ onSuccess }) => {
    const { service } = useBlockchain();
    const [formData, setFormData] = useState<Omit<Agent, 'createdAt'>>({
        id: '',
        name: '',
        provider: '',
        version: '',
        fingerprintHash: ''
    });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [generatedHash, setGeneratedHash] = useState(false);
    const [useEIP712, setUseEIP712] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value, type, checked } = e.target;
        if (type === 'checkbox') {
            if (name === 'useEIP712') setUseEIP712(checked);
        } else {
            setFormData(prev => ({ ...prev, [name]: value }));
            if (name !== 'fingerprintHash' && generatedHash) setGeneratedHash(false);
        }
    };

    const handleCopy = () => {
        if (!formData.fingerprintHash) return;
        navigator.clipboard.writeText(formData.fingerprintHash);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const generateFingerprint = () => {
        const { id, name, provider, version } = formData;
        if (!id.trim() || !name.trim() || !provider.trim() || !version.trim()) {
            setError('Please fill in all agent details before generating a fingerprint hash');
            return;
        }

        try {
            const hash = service?.generateFingerprintHash({ id, name, provider, version });
            if (hash) {
                setFormData(prev => ({ ...prev, fingerprintHash: hash }));
                setGeneratedHash(true);
                setError(null);
            } else {
                setError('Failed to generate fingerprint hash: Service not available');
            }
        } catch (err) {
            setError('Error generating fingerprint hash: ' + (err instanceof Error ? err.message : String(err)));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!service) {
            setError('Service not available');
            return;
        }

        for (const [key, value] of Object.entries(formData)) {
            if (typeof value === 'string' && !value.trim()) {
                setError(`${key} is required`);
                return;
            }
        }

        if (!isValidFingerprintFormat(formData.fingerprintHash)) {
            setError('Fingerprint hash should be a valid keccak256 hash (0x followed by 64 hex characters)');
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            const success = await service?.registerFingerprint(formData, useEIP712);
            if (success) {
                onSuccess(formData);
            } else {
                setError('Failed to register fingerprint');
            }
        } catch (err) {
            setError('Error registering fingerprint: ' + (err instanceof Error ? err.message : String(err)));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fingerprint-form">
            <h3 style={{ marginBottom: '24px', fontSize: '1.2rem', fontWeight: 600 }}>Identity Registration</h3>
            
            <form onSubmit={handleSubmit}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                    <div className="form-group">
                        <label htmlFor="id">Agent ID</label>
                        <input
                            type="text"
                            id="id"
                            name="id"
                            className="form-input"
                            value={formData.id}
                            onChange={handleChange}
                            disabled={submitting}
                            placeholder="e.g. medical-triage-agent-01"
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="name">Friendly Name</label>
                        <input
                            type="text"
                            id="name"
                            name="name"
                            className="form-input"
                            value={formData.name}
                            onChange={handleChange}
                            disabled={submitting}
                            placeholder="e.g. TriageBot Beta"
                        />
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                    <div className="form-group">
                        <label htmlFor="provider">Provider / Model Family</label>
                        <input
                            type="text"
                            id="provider"
                            name="provider"
                            className="form-input"
                            value={formData.provider}
                            onChange={handleChange}
                            disabled={submitting}
                            placeholder="e.g. Ollama (Llama3)"
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="version">Operational Version</label>
                        <input
                            type="text"
                            id="version"
                            name="version"
                            className="form-input"
                            value={formData.version}
                            onChange={handleChange}
                            disabled={submitting}
                            placeholder="e.g. 1.4.2"
                        />
                    </div>
                </div>

                <div className="form-group" style={{ marginBottom: '24px' }}>
                    <label htmlFor="fingerprintHash">Blockchain Fingerprint Hash</label>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <input
                            type="text"
                            id="fingerprintHash"
                            name="fingerprintHash"
                            className="form-input tabular-nums"
                            value={formData.fingerprintHash}
                            onChange={handleChange}
                            disabled={submitting}
                            placeholder="0x..."
                        />
                        <button
                            type="button"
                            className="secondary-btn"
                            style={{ whiteSpace: 'nowrap', padding: '10px 16px' }}
                            onClick={generateFingerprint}
                            disabled={submitting}
                        >
                            Auto-Generate
                        </button>
                        {formData.fingerprintHash && (
                            <button
                                type="button"
                                className="icon-btn"
                                style={{ 
                                    border: '1px solid var(--plasma-border)', 
                                    padding: '10px',
                                    color: copied ? 'var(--plasma-integrity-green)' : 'inherit'
                                }}
                                onClick={handleCopy}
                                aria-label="Copy fingerprint hash"
                                title="Copy to clipboard"
                            >
                                {copied ? '✓' : '📋'}
                            </button>
                        )}
                    </div>
                    <p className="text-muted" style={{ fontSize: '0.7rem', marginTop: '8px' }}>
                        Deterministic keccak256 hash of agent metadata.
                    </p>
                </div>

                <div className="form-group">
                    <label className="signature-toggle">
                        <input
                            type="checkbox"
                            name="useEIP712"
                            checked={useEIP712}
                            onChange={handleChange}
                            disabled={submitting}
                        />
                        <span>Enable EIP-712 Typed Signature</span>
                    </label>
                    <p className="signature-help">
                        Enhances security by providing human-readable verification during the blockchain anchoring process.
                    </p>
                </div>

                <div style={{ marginTop: '32px' }}>
                    <button type="submit" className="primary-btn" style={{ width: '100%', padding: '14px' }} disabled={submitting}>
                        {submitting ? 'Anchoring to Blockchain...' : 'Confirm Identity Registration'}
                    </button>
                </div>
            </form>

            {error && <p className="text-error" style={{ marginTop: '16px', fontSize: '0.9rem' }}>{error}</p>}
        </div>
    );
};

export default FingerprintForm;


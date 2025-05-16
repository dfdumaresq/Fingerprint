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

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value, type, checked } = e.target;

        if (type === 'checkbox') {
            if (name === 'useEIP712') {
                setUseEIP712(checked);
            }
        } else {
            setFormData(prev => ({ ...prev, [name]: value }));

            // Reset generated hash state if any field other than fingerprintHash changes
            if (name !== 'fingerprintHash' && generatedHash) {
                setGeneratedHash(false);
            }
        }
    };

    const generateFingerprint = () => {
        // Validate required fields before generating fingerprint
        const { id, name, provider, version } = formData;
        if (!id.trim() || !name.trim() || !provider.trim() || !version.trim()) {
            setError('Please fill in all agent details before generating a fingerprint hash');
            return;
        }

        try {
            // Use the static method or make sure to update the blockchain service
            const hash = service?.generateFingerprintHash({
                id: formData.id,
                name: formData.name,
                provider: formData.provider,
                version: formData.version
            });

            if (hash) {
                setFormData(prev => ({ ...prev, fingerprintHash: hash }));
                setGeneratedHash(true);
                setError(null);
            } else {
                setError('Failed to generate fingerprint hash: Service not available')
            }
        } catch (err) {
            setError('Error generating fingerprint hash: ' + (err instanceof Error ? err.message : String(err)));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!service) {
            setError('Service not available')
            return;
        }

        // Validate form data
        for (const [key, value] of Object.entries(formData)) {
            if (typeof value === 'string' && !value.trim()) {
                setError(`${key} is required`);
                return;
            }
        }

        // Validate fingerprint hash format
        if (!isValidFingerprintFormat(formData.fingerprintHash)) {
            setError('Fingerprint hash should be a valid keccak256 hash (0x followed by 64 hex characters)');
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            // Pass the useEIP712 flag to the blockchain service
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
            <h2>Register AI Agent Fingerprint</h2>

            <form onSubmit={handleSubmit}>
                <div className="form-group">
                    <label htmlFor="id">Agent ID</label>
                    <input
                        type="text"
                        id="id"
                        name="id"
                        value={formData.id}
                        onChange={handleChange}
                        disabled={submitting}
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="name">Agent Name</label>
                    <input
                        type="text"
                        id="name"
                        name="name"
                        value={formData.name}
                        onChange={handleChange}
                        disabled={submitting}
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="provider">Provider</label>
                    <input
                        type="text"
                        id="provider"
                        name="provider"
                        value={formData.provider}
                        onChange={handleChange}
                        disabled={submitting}
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="version">Version</label>
                    <input
                        type="text"
                        id="version"
                        name="version"
                        value={formData.version}
                        onChange={handleChange}
                        disabled={submitting}
                    />
                </div>

                <div className="form-group fingerprint-group">
                    <label htmlFor="fingerprintHash">Fingerprint Hash</label>
                    <div className="fingerprint-input-container">
                        <input
                            type="text"
                            id="fingerprintHash"
                            name="fingerprintHash"
                            value={formData.fingerprintHash}
                            onChange={handleChange}
                            disabled={submitting}
                            className={generatedHash ? 'generated valid-input' : isValidFingerprintFormat(formData.fingerprintHash) ? 'valid-input' : (formData.fingerprintHash.length > 0 ? 'invalid-input' : '')}
                            placeholder="0x..."
                        />
                        <button
                            type="button"
                            className="generate-button"
                            onClick={generateFingerprint}
                            disabled={submitting}
                        >
                            Generate
                        </button>
                    </div>
                    <div className="input-help">
                        Format: 0x followed by 64 hexadecimal characters, or click "Generate" to create automatically
                    </div>
                </div>

                <div className="form-group checkbox-group">
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            name="useEIP712"
                            checked={useEIP712}
                            onChange={handleChange}
                            disabled={submitting}
                        />
                        Use EIP-712 typed data signature (enhanced security)
                    </label>
                    <div className="input-help">
                        EIP-712 provides better security with human-readable, structured data in signatures
                    </div>
                </div>

                <button type="submit" disabled={submitting}>
                    {submitting ? 'Registering...' : 'Register Fingerprint'}
                </button>
            </form>

            {error && <p className="error-message">{error}</p>}
        </div>
    );
};

export default FingerprintForm;

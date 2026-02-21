/**
 * C2PAService: Orchestrates provenance manifest generation and identity management.
 * High-level API for the application.
 */

import { ProvenanceSigner } from './signer.service';
import { LocalStorageKeyStore } from './keystore.service';
import { C2PAAssertion, ProvenanceManifest } from '../types/c2pa';
import { Agent } from '../types';
import { VerificationResult } from '../utils/behavioral.utils';

export class C2PAService {
  private signer: ProvenanceSigner;

  constructor() {
    this.signer = new ProvenanceSigner(new LocalStorageKeyStore());
  }

  /**
   * Create an identity manifest (Nutrition Label) for an AI Agent
   */
  async generateIdentityManifest(agent: Agent): Promise<ProvenanceManifest> {
    const assertions: C2PAAssertion[] = [
      {
        label: 'com.fingerprint.identity.v1',
        data: {
          agent_id: agent.id,
          softwareAgent: 'Fingerprint Verification System v1.0',
          model_details: {
            provider: agent.provider,
            model_version: agent.version,
            training_data_policy: 'Opt-out/Non-mining preference'
          },
          fingerprint_registry: '0x000000000000000000000000000000000000000', // Registry address
          assertion_type: 'c2pa.training_mining'
        }
      }
    ];

    return this.signer.signManifest(agent.id, 'org.fingerprint.agent_identity', assertions);
  }

  /**
   * Create a verification certificate assertion
   */
  async generateVerificationManifest(
    agentId: string, 
    result: VerificationResult
  ): Promise<ProvenanceManifest> {
    const assertions: C2PAAssertion[] = [
      {
        label: 'com.fingerprint.verification.v1',
        data: {
          similarity_score: result.similarity,
          perturbation_score: result.perturbation.perturbationScore,
          suspicious: result.perturbation.suspicious,
          fingerprint_hash: agentId,
          verification_timestamp: new Date().toISOString(),
          mode: result.mode,
          verdict: result.match ? 'pass' : 'fail'
        }
      }
    ];

    return this.signer.signManifest(agentId, 'org.fingerprint.verification_cert', assertions);
  }

  /**
   * Helper to initialize a new identity key
   */
  async initializeIdentity(agentId: string): Promise<string> {
    return this.signer.createNewIdentity(agentId);
  }

  /**
   * Export manifest as a serializable JSON string
   * This can be saved as a .c2pa.json sidecar file
   */
  exportManifest(manifest: ProvenanceManifest): string {
    return JSON.stringify({
      "@context": "https://c2pa.org/schemas/v1",
      "type": "manifest",
      ...manifest
    }, null, 2);
  }

  /**
   * Verify an external manifest
   * @param manifest The manifest object (parsed from JSON)
   * @returns Boolean indicating if the signature is valid
   */
  async verifyExternalManifest(manifest: ProvenanceManifest): Promise<boolean> {
    return this.signer.verifyManifest(manifest);
  }
}

/**
 * ProvenanceSigner: Handles cryptographic signing for C2PA manifests
 * Uses WebCrypto for secure, standard-compliant signing.
 */

import { KeyStore, C2PAAssertion, ProvenanceManifest } from '../types/c2pa';

// Cross-environment crypto reference
const getCrypto = () => {
  if (typeof window !== 'undefined' && window.crypto) return window.crypto;
  if (typeof global !== 'undefined' && (global as any).crypto) return (global as any).crypto;
  throw new Error('WebCrypto API not found');
};

export class ProvenanceSigner {
  private keyStore: KeyStore;

  constructor(keyStore: KeyStore) {
    this.keyStore = keyStore;
  }

  /**
   * Helper to encode to base64
   */
  private toBase64(buffer: ArrayBuffer): string {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(buffer).toString('base64');
    }
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  /**
   * Helper to decode from base64
   */
  private fromBase64(base64: string): Uint8Array {
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(base64, 'base64'));
    }
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Generate a new P-256 signing key for content provenance
   */
  async createNewIdentity(id: string): Promise<string> {
    const crypto = getCrypto();
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-256'
      },
      true,
      ['sign', 'verify']
    );

    await this.keyStore.saveKey(id, keyPair);
    
    // Export public key as SPKI (Subject Public Key Info) for the certificate
    const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
    return this.toBase64(spki);
  }

  /**
   * Sign a set of C2PA assertions
   */
  async signManifest(
    identityId: string, 
    label: string, 
    assertions: C2PAAssertion[],
    metadata?: {
        claim_generator?: string;
        generator_version?: string;
        vendor?: string;
        subject?: string;
        description?: string;
    }
  ): Promise<ProvenanceManifest> {
    const keyPair = await this.keyStore.getKey(identityId);
    if (!keyPair) {
      throw new Error(`Identity key ${identityId} not found`);
    }

    const crypto = getCrypto();
    // Prepare data for signing (simplified manifest structure)
    // In actual C2PA, this would be encoded as JUMBF
    const manifestData = JSON.stringify({ label, assertions });
    const dataEncoder = new TextEncoder();
    const dataBytes = dataEncoder.encode(manifestData);

    const signature = await crypto.subtle.sign(
      {
        name: 'ECDSA',
        hash: { name: 'SHA-256' }
      },
      keyPair.privateKey,
      dataBytes
    );

    const publicKeySpki = await crypto.subtle.exportKey('spki', keyPair.publicKey);

    return {
      label,
      ...metadata,
      assertions,
      signature: this.toBase64(signature),
      signerPublicKey: this.toBase64(publicKeySpki)
    };
  }

  /**
   * Verify a signed manifest (Internal/Client-side check)
   */
  async verifyManifest(manifest: ProvenanceManifest): Promise<boolean> {
    if (!manifest.signature) return false;

    try {
      const crypto = getCrypto();
      const pubKeyBytes = this.fromBase64(manifest.signerPublicKey);
      const publicKey = await crypto.subtle.importKey(
        'spki',
        pubKeyBytes,
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['verify']
      );

      const manifestData = JSON.stringify({ 
        label: manifest.label, 
        assertions: manifest.assertions 
      });
      const dataEncoder = new TextEncoder();
      const dataBytes = dataEncoder.encode(manifestData);
      const signatureBytes = this.fromBase64(manifest.signature);

      return await crypto.subtle.verify(
        {
          name: 'ECDSA',
          hash: { name: 'SHA-256' }
        },
        publicKey,
        signatureBytes,
        dataBytes
      );
    } catch (e) {
      console.error('Manifest verification failed:', e);
      return false;
    }
  }
}

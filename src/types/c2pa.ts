/**
 * C2PA Integrity and Key Management Types
 */

export interface KeyStore {
  /** Save a signing key (encrypted) */
  saveKey(id: string, key: CryptoKeyPair): Promise<void>;
  /** Retrieve a signing key */
  getKey(id: string): Promise<CryptoKeyPair | null>;
  /** List available key IDs */
  listKeys(): Promise<string[]>;
  /** Delete a key */
  deleteKey(id: string): Promise<void>;
}

export interface ProvenanceManifest {
  label: string;
  assertions: C2PAAssertion[];
  signature?: string;
  signerPublicKey: string;
}

export interface C2PAAssertion {
  label: string;
  data: any;
  metadata?: {
    dateTime?: string;
    [key: string]: any;
  };
}

/**
 * Configuration for the C2PA Service
 */
export interface C2PAConfig {
  keyStoreType: 'local' | 'memory' | 'extension';
  defaultAlgorithm: 'ES256' | 'Ed25519';
  orgName: string;
}

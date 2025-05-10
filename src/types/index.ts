// Agent types
export interface Agent {
  id: string;
  name: string;
  provider: string;
  version: string;
  fingerprintHash: string;
  createdAt: number;
  signature?: string;
  signerAddress?: string;
  revoked?: boolean;         // Indicates if the fingerprint has been revoked
  revokedAt?: number;        // Timestamp when the fingerprint was revoked
  revokedBy?: string;        // Address of account that revoked the fingerprint
}

// Blockchain types
export interface BlockchainConfig {
  networkUrl: string;
  chainId: number;
  contractAddress: string;
}

// Response types
export interface VerificationResult {
  isVerified: boolean;
  fingerprintData?: Agent;
  error?: string;
  signatureValid?: boolean;
  signerAddress?: string;
  revoked?: boolean;
  revokedAt?: number;
  revokedBy?: string;
}

// EIP-712 types
export interface SignatureData {
  signature: string;
  signerAddress: string;
  timestamp: number;
}

// Revocation types
export interface RevocationData {
  revoked: boolean;
  revokedAt: number;
  revokedBy: string;
}
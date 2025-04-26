// Agent types
export interface Agent {
  id: string;
  name: string;
  provider: string;
  version: string;
  fingerprintHash: string;
  createdAt: number;
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
}
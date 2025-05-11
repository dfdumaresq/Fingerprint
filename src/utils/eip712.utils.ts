/**
 * EIP-712 Typed Data structure and utility functions
 * https://eips.ethereum.org/EIPS/eip-712
 */
import { ethers } from 'ethers';
import { Agent } from '../types';

/**
 * TypedDataField defines a field in an EIP-712 struct
 */
export interface TypedDataField {
  name: string;
  type: string;
}

/**
 * TypedDataTypes defines the types used in an EIP-712 typed data structure
 */
export interface TypedDataTypes {
  [typeName: string]: Array<TypedDataField>;
}

/**
 * EIP-712 Domain parameters
 */
export interface EIP712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

/**
 * EIP-712 Domain definition for AI Fingerprint app
 */
export const EIP712_DOMAIN: Omit<EIP712Domain, 'chainId' | 'verifyingContract'> = {
  name: 'AIFingerprint',
  version: '1',
  // chainId is set dynamically at runtime
  // verifyingContract is set dynamically at runtime
};

/**
 * EIP-712 Message type definitions for agent fingerprinting
 */
export const AGENT_FINGERPRINT_TYPES: TypedDataTypes = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ],
  AgentFingerprint: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'provider', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'timestamp', type: 'uint256' },
  ],
};

/**
 * EIP-712 message structure for Agent Fingerprints
 */
export interface AgentFingerprintMessage {
  id: string;
  name: string;
  provider: string;
  version: string;
  timestamp: number;
}

/**
 * Generic typed data object structure
 */
export interface TypedData<T extends Record<string, any>> {
  types: TypedDataTypes;
  primaryType: string;
  domain: EIP712Domain;
  message: T;
}

/**
 * Create an EIP-712 domain object for the current network and contract
 * @param chainId The blockchain network ID
 * @param contractAddress The smart contract address
 * @returns Complete EIP-712 domain object
 */
export function createEIP712Domain(chainId: number | bigint, contractAddress: string): EIP712Domain {
  return {
    ...EIP712_DOMAIN,
    chainId: typeof chainId === 'bigint' ? Number(chainId) : chainId,
    verifyingContract: contractAddress,
  };
}

/**
 * Create an EIP-712 message from agent data
 * @param agent Agent information
 * @returns EIP-712 formatted message
 */
export function createAgentFingerprintMessage(
  agent: Pick<Agent, 'id' | 'name' | 'provider' | 'version'>
): AgentFingerprintMessage {
  return {
    id: agent.id,
    name: agent.name,
    provider: agent.provider,
    version: agent.version,
    timestamp: Math.floor(Date.now() / 1000), // Current time in seconds
  };
}

/**
 * Create an EIP-712 typed data hash for an agent fingerprint
 * @param domain EIP-712 domain parameters
 * @param message Agent fingerprint message
 * @returns Typed data hash
 */
export function hashAgentFingerprint(
  domain: EIP712Domain,
  message: AgentFingerprintMessage
): string {
  // Create the typed data object
  const typedData: TypedData<AgentFingerprintMessage> = {
    types: AGENT_FINGERPRINT_TYPES,
    primaryType: 'AgentFingerprint',
    domain,
    message,
  };

  // Hash the typed data according to EIP-712
  return ethers.TypedDataEncoder.hash(
    typedData.domain,
    { AgentFingerprint: AGENT_FINGERPRINT_TYPES.AgentFingerprint },
    typedData.message
  );
}

/**
 * Generate a typed signature for agent fingerprint data
 * @param signer Ethers.js Signer object
 * @param domain EIP-712 domain parameters
 * @param message Agent fingerprint data
 * @returns Promise resolving to signature string
 */
export async function signAgentFingerprint(
  signer: ethers.Signer,
  domain: EIP712Domain,
  message: AgentFingerprintMessage
): Promise<string> {
  // Create the typed data types object
  const types = {
    AgentFingerprint: AGENT_FINGERPRINT_TYPES.AgentFingerprint
  };

  // Use ethers.js v6 to sign the typed data
  return await signer.signTypedData(
    domain,
    types,
    message
  );
}

/**
 * Verify EIP-712 signature for an agent fingerprint
 * @param signature The EIP-712 signature to verify
 * @param domain EIP-712 domain parameters
 * @param message Agent fingerprint message
 * @returns The address that signed the message, or null if invalid
 */
export function verifyAgentFingerprintSignature(
  signature: string,
  domain: EIP712Domain,
  message: AgentFingerprintMessage
): string | null {
  try {
    // Create the typed data types
    const types = {
      AgentFingerprint: AGENT_FINGERPRINT_TYPES.AgentFingerprint
    };

    // Recover the signer address from the signature
    const recoveredAddress = ethers.verifyTypedData(
      domain,
      types,
      message,
      signature
    );

    return recoveredAddress;
  } catch (error) {
    console.error('Failed to verify signature:', error);
    return null;
  }
}

/**
 * Create the full EIP-712 typed data structure for an agent fingerprint
 * @param chainId The blockchain network ID
 * @param contractAddress The smart contract address
 * @param agent Agent information
 * @returns Complete EIP-712 typed data object
 */
export function createAgentFingerprintTypedData(
  chainId: number,
  contractAddress: string,
  agent: Pick<Agent, 'id' | 'name' | 'provider' | 'version'>
): TypedData<AgentFingerprintMessage> {
  const domain = createEIP712Domain(chainId, contractAddress);
  const message = createAgentFingerprintMessage(agent);

  return {
    types: AGENT_FINGERPRINT_TYPES,
    primaryType: 'AgentFingerprint',
    domain,
    message,
  };
}
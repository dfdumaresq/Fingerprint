/**
 * EIP-712 Typed Data structure and utility functions
 * https://eips.ethereum.org/EIPS/eip-712
 */
import { ethers } from 'ethers';
import { Agent } from '../types';
import { EIP712Error, EIP712SigningError, EIP712VerificationError } from './eip712.errors';
import { isEIP712Domain, isAgentFingerprintMessage, isValidEIP712Signature } from './eip712.guards';

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
 * @throws EIP712Error if the domain parameters are invalid
 */
export function createEIP712Domain(chainId: number | bigint, contractAddress: string): EIP712Domain {
  const domain = {
    ...EIP712_DOMAIN,
    chainId: typeof chainId === 'bigint' ? Number(chainId) : chainId,
    verifyingContract: contractAddress,
  };

  // Validate the domain
  if (!isEIP712Domain(domain)) {
    throw new EIP712Error('Invalid EIP-712 domain parameters');
  }

  return domain;
}

/**
 * Create an EIP-712 message from agent data
 * @param agent Agent information
 * @returns EIP-712 formatted message
 * @throws EIP712Error if the message parameters are invalid
 */
export function createAgentFingerprintMessage(
  agent: Pick<Agent, 'id' | 'name' | 'provider' | 'version'>
): AgentFingerprintMessage {
  const message = {
    id: agent.id,
    name: agent.name,
    provider: agent.provider,
    version: agent.version,
    timestamp: Math.floor(Date.now() / 1000), // Current time in seconds
  };

  // Validate the message
  if (!isAgentFingerprintMessage(message)) {
    throw new EIP712Error('Invalid EIP-712 message parameters');
  }

  return message;
}

/**
 * Create an EIP-712 typed data hash for an agent fingerprint
 * @param domain EIP-712 domain parameters
 * @param message Agent fingerprint message
 * @returns Typed data hash
 * @throws EIP712Error if the domain or message parameters are invalid
 */
export function hashAgentFingerprint(
  domain: EIP712Domain,
  message: AgentFingerprintMessage
): string {
  // Validate inputs
  if (!isEIP712Domain(domain)) {
    throw new EIP712Error('Invalid EIP-712 domain parameters');
  }

  if (!isAgentFingerprintMessage(message)) {
    throw new EIP712Error('Invalid EIP-712 message parameters');
  }

  // Create the typed data object
  const typedData: TypedData<AgentFingerprintMessage> = {
    types: AGENT_FINGERPRINT_TYPES,
    primaryType: 'AgentFingerprint',
    domain,
    message,
  };

  try {
    // Hash the typed data according to EIP-712
    return ethers.TypedDataEncoder.hash(
      typedData.domain,
      { AgentFingerprint: AGENT_FINGERPRINT_TYPES.AgentFingerprint },
      typedData.message
    );
  } catch (error) {
    throw new EIP712Error(`Failed to hash typed data: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Generate a typed signature for agent fingerprint data
 * @param signer Ethers.js Signer object
 * @param domain EIP-712 domain parameters
 * @param message Agent fingerprint data
 * @returns Promise resolving to signature string
 * @throws EIP712SigningError if signing fails
 */
export async function signAgentFingerprint(
  signer: ethers.Signer,
  domain: EIP712Domain,
  message: AgentFingerprintMessage
): Promise<string> {
  // Validate inputs
  if (!isEIP712Domain(domain)) {
    throw new EIP712Error('Invalid EIP-712 domain parameters');
  }

  if (!isAgentFingerprintMessage(message)) {
    throw new EIP712Error('Invalid EIP-712 message parameters');
  }

  if (!signer) {
    throw new EIP712SigningError('No signer provided');
  }

  try {
    // Create the typed data types object
    const types = {
      AgentFingerprint: AGENT_FINGERPRINT_TYPES.AgentFingerprint
    };

    // Use ethers.js v6 to sign the typed data
    const signature = await signer.signTypedData(
      domain,
      types,
      message
    );

    // Validate signature format
    if (!isValidEIP712Signature(signature)) {
      throw new EIP712SigningError(`Invalid signature format: ${signature}`);
    }

    return signature;
  } catch (error) {
    if (error instanceof EIP712Error) {
      throw error;
    }
    throw new EIP712SigningError(`Failed to sign typed data: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Verify EIP-712 signature for an agent fingerprint
 * @param signature The EIP-712 signature to verify
 * @param domain EIP-712 domain parameters
 * @param message Agent fingerprint message
 * @returns The address that signed the message, or null if invalid
 * @throws EIP712VerificationError if verification fails
 */
export function verifyAgentFingerprintSignature(
  signature: string,
  domain: EIP712Domain,
  message: AgentFingerprintMessage
): string | null {
  try {
    // Validate inputs
    if (!isValidEIP712Signature(signature)) {
      throw new EIP712VerificationError('Invalid EIP-712 signature format', signature);
    }

    if (!isEIP712Domain(domain)) {
      throw new EIP712Error('Invalid EIP-712 domain parameters');
    }

    if (!isAgentFingerprintMessage(message)) {
      throw new EIP712Error('Invalid EIP-712 message parameters');
    }

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
    if (error instanceof EIP712Error) {
      throw error;
    }
    throw new EIP712VerificationError(
      `Failed to verify signature: ${error instanceof Error ? error.message : String(error)}`,
      signature
    );
  }
}

/**
 * Create the full EIP-712 typed data structure for an agent fingerprint
 * @param chainId The blockchain network ID
 * @param contractAddress The smart contract address
 * @param agent Agent information
 * @returns Complete EIP-712 typed data object
 * @throws EIP712Error if the parameters are invalid
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
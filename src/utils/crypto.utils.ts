import { ethers } from 'ethers';
import stringify from 'fast-json-stable-stringify';

/**
 * Deterministically hash an event payload following our canonicalization spec
 * Uses fast-json-stable-stringify to ensure alphabetical key ordering
 */
export function generateEventHash(payload: any, previousHash: string | null, timestampStr: string): string {
  // Filter out null/undefined to ensure consistency between memory and DB objects
  const filteredPayload = Object.fromEntries(
    Object.entries(payload).filter(([_, v]) => v !== null && v !== undefined)
  );

  const canonicalObject = {
    ...filteredPayload,
    timestamp: timestampStr,
    previous_event_hash: previousHash
  };
  
  // Deterministic JSON stringify avoids key ordering/whitespace bugs
  const jsonString = stringify(canonicalObject);
  
  // Keccak256 hash (same as Solidity)
  return ethers.id(jsonString);
}

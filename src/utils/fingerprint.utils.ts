/**
 * Utility functions for fingerprint generation and validation
 */

/**
 * Validate a fingerprint hash format
 * @param hash The fingerprint hash to validate
 * @returns Boolean indicating if the hash has valid format
 */
export const isValidFingerprintFormat = (hash: string): boolean => {
  // Basic validation for keccak256 hash format (0x followed by 64 hex characters)
  const isValid = /^0x[0-9a-f]{64}$/i.test(hash);
  console.log(`Validating fingerprint format: ${hash}, valid: ${isValid}`);
  
  // Log more details if invalid
  if (!isValid) {
    if (!hash.startsWith('0x')) {
      console.log('Fingerprint missing 0x prefix');
    }
    if (hash.length !== 66) {
      console.log(`Fingerprint incorrect length: ${hash.length}, expected: 66`);
    }
  }
  
  return isValid;
};

/**
 * Format a timestamp into a human-readable date string
 * @param timestamp UNIX timestamp in seconds
 * @returns Formatted date string
 */
export const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Format an Ethereum address for display (0x1234...5678)
 * @param address The full Ethereum address
 * @returns Shortened address string
 */
export const formatAddress = (address: string): string => {
  if (!address || address.length < 10) return address;
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
};
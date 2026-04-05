/**
 * Centralized configuration for C2PA manifest generators.
 * Provides a single source of truth for generator identity and versioning.
 */

export const MANIFEST_GENERATORS = {
  agentIdentity: {
    name: 'Fingerprint.AI/agent-identity',
    version: '1.0.0', // patch: bug fix, minor: backward-compatible, major: breaking schema
    vendor: 'fingerprint'
  },
  behavioralAudit: {
    name: 'Fingerprint.AI/behavioral-audit',
    version: '1.0.0',
    vendor: 'fingerprint'
  }
} as const;

/**
 * Build a standard claim_generator string from name and version.
 * @example buildClaimGenerator('Fingerprint.AI/agent-identity', '1.0.0') -> 'Fingerprint.AI/agent-identity-1.0.0'
 */
export function buildClaimGenerator(name: string, version: string): string {
  return `${name}-${version}`;
}

/**
 * Standard summary text for behavioral audit certificates.
 */
export function buildBehavioralAuditDescription(mode: string): string {
  return `Signed audit certificate recording the behavioral verification result for the referenced fingerprint under ${mode} mode. This document is intended for review, export, and external compliance validation.`;
}

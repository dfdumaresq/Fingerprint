/**
 * C2PA Export Utilities
 * Utilities for downloading and managing C2PA sidecar files in the browser.
 */

import { ProvenanceManifest } from '../types/c2pa';

/**
 * Trigger a browser download of a C2PA manifest sidecar
 */
export function downloadC2PAManifest(
  manifest: ProvenanceManifest, 
  filename: string = 'manifest.c2pa.json'
): void {
  const jsonString = JSON.stringify({
    "@context": "https://c2pa.org/schemas/v1",
    "type": "manifest",
    ...manifest
  }, null, 2);

  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}

/**
 * Create a specialized filename for a verification certificate
 */
export function getVerificationFilename(agentId: string): string {
  const date = new Date().toISOString().split('T')[0];
  return `verification-${agentId}-${date}.c2pa.json`;
}

/**
 * Create a specialized filename for an identity manifest
 */
export function getIdentityFilename(agentId: string): string {
  return `identity-${agentId}.c2pa.json`;
}

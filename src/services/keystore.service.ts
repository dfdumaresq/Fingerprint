/**
 * KeyStore implementation using browser LocalStorage
 * Note: For production, this should include encryption at rest (e.g., via user passphrase)
 */

import { KeyStore } from '../types/c2pa';

// Cross-environment crypto reference
const getCrypto = () => {
  if (typeof window !== 'undefined' && window.crypto) return window.crypto;
  if (typeof global !== 'undefined' && (global as any).crypto) return (global as any).crypto;
  throw new Error('WebCrypto API not found');
};

export class LocalStorageKeyStore implements KeyStore {
  private prefix = 'c2pa_key_';

  async saveKey(id: string, key: CryptoKeyPair): Promise<void> {
    const crypto = getCrypto();
    // Export keys to JWK format for storage
    const publicKeyJwk = await crypto.subtle.exportKey('jwk', key.publicKey);
    const privateKeyJwk = await crypto.subtle.exportKey('jwk', key.privateKey);

    const storageObj = {
      publicKey: publicKeyJwk,
      privateKey: privateKeyJwk,
      updatedAt: new Date().toISOString()
    };

    localStorage.setItem(`${this.prefix}${id}`, JSON.stringify(storageObj));
  }

  async getKey(id: string): Promise<CryptoKeyPair | null> {
    const raw = localStorage.getItem(`${this.prefix}${id}`);
    if (!raw) return null;

    try {
      const { publicKey, privateKey } = JSON.parse(raw);
      
      const crypto = getCrypto();
      // Import back to CryptoKey objects
      const pub = await crypto.subtle.importKey(
        'jwk',
        publicKey,
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['verify']
      );

      const priv = await crypto.subtle.importKey(
        'jwk',
        privateKey,
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign']
      );

      return { publicKey: pub, privateKey: priv };
    } catch (e) {
      console.error('Failed to import C2PA key from storage:', e);
      return null;
    }
  }

  async listKeys(): Promise<string[]> {
    return Object.keys(localStorage)
      .filter(k => k.startsWith(this.prefix))
      .map(k => k.replace(this.prefix, ''));
  }

  async deleteKey(id: string): Promise<void> {
    localStorage.removeItem(`${this.prefix}${id}`);
  }
}

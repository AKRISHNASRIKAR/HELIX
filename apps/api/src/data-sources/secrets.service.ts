import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { ApiEnv } from '../config/env';

export interface EncryptedPayload {
  iv: string;
  authTag: string;
  ciphertext: string;
}

const ALGORITHM = 'aes-256-gcm';

/**
 * The "secret manager" interface from docs/architecture/data-flow.md, backed
 * for now by AES-256-GCM with a key from HELIX_SECRETS_KEY. Ciphertexts are
 * stored in DataSourceCredential; plaintext only ever exists in memory while
 * building a ConnectionSpec. Swapping in Vault/KMS later only touches this class.
 */
@Injectable()
export class SecretsService {
  private readonly key: Buffer;

  constructor(config: ConfigService<ApiEnv, true>) {
    const encoded: string = config.get('HELIX_SECRETS_KEY', { infer: true });
    this.key = Buffer.from(encoded, 'base64');
    if (this.key.length !== 32) throw new Error('HELIX_SECRETS_KEY must decode to 32 bytes');
  }

  encrypt(value: Record<string, unknown>): EncryptedPayload {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), 'utf8'),
      cipher.final(),
    ]);
    return {
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  /** Throws if the payload was tampered with or encrypted under a different key. */
  decrypt(payload: EncryptedPayload): Record<string, unknown> {
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8')) as Record<string, unknown>;
  }
}

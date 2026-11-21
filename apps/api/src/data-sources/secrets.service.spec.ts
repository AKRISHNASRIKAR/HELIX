import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { SecretsService } from './secrets.service';

const make = (key: string) =>
  new SecretsService({ get: () => key } as unknown as ConfigService<never, true>);

describe('SecretsService', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips a credentials object', () => {
    const secrets = make(key);
    const creds = { user: 'analyst', password: 'p@ss w0rd ✓' };
    const enc = secrets.encrypt(creds);
    expect(enc.ciphertext).not.toContain('analyst');
    expect(secrets.decrypt(enc)).toEqual(creds);
  });

  it('uses a fresh IV per encryption', () => {
    const secrets = make(key);
    const a = secrets.encrypt({ x: 1 });
    const b = secrets.encrypt({ x: 1 });
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('rejects tampered ciphertext (GCM auth tag)', () => {
    const secrets = make(key);
    const enc = secrets.encrypt({ user: 'u', password: 'p' });
    const bytes = Buffer.from(enc.ciphertext, 'base64');
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    expect(() => secrets.decrypt({ ...enc, ciphertext: bytes.toString('base64') })).toThrow();
  });

  it('cannot decrypt with a different key', () => {
    const enc = make(key).encrypt({ user: 'u' });
    expect(() => make(randomBytes(32).toString('base64')).decrypt(enc)).toThrow();
  });

  it('refuses keys that are not 32 bytes', () => {
    expect(() => make(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});

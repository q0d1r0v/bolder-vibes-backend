import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from 'crypto';
import { PrismaService } from '@/prisma/prisma.service.js';

/**
 * AES-256-GCM envelope for user-provided third-party tokens (Expo PAT).
 * Ciphertext layout (base64-joined with `|`):
 *   iv (12 bytes) | authTag (16 bytes) | ciphertext (N bytes)
 *
 * The raw key material is derived from the 32-char server secret via
 * SHA-256 so we always feed AES-256-GCM exactly 32 key bytes regardless
 * of the user-supplied secret length.
 */
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

export interface ExpoTokenStatus {
  set: boolean;
  hint?: string;
  setAt?: string;
}

@Injectable()
export class ExpoAccountService {
  private readonly logger = new Logger(ExpoAccountService.name);
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const secret = this.configService.get<string>('auth.secretsEncryptionKey');
    if (!secret) {
      throw new Error('SECRETS_ENCRYPTION_KEY is not configured');
    }
    this.key = createHash('sha256').update(secret, 'utf8').digest();
  }

  async getStatus(userId: string): Promise<ExpoTokenStatus> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { expoTokenEnc: true, expoTokenSetAt: true },
    });
    if (!user?.expoTokenEnc) {
      return { set: false };
    }
    // Try to decrypt so we can show a last-4 hint. If decryption fails
    // (key rotated), we report the token as set but with no hint so the
    // user knows to re-enter it.
    let hint: string | undefined;
    try {
      const plain = this.decrypt(user.expoTokenEnc);
      hint = plain.length <= 4 ? '****' : `••••${plain.slice(-4)}`;
    } catch {
      hint = undefined;
    }
    return {
      set: true,
      hint,
      setAt: user.expoTokenSetAt?.toISOString(),
    };
  }

  async setToken(userId: string, token: string): Promise<ExpoTokenStatus> {
    const trimmed = token.trim();
    if (!trimmed) {
      throw new BadRequestException('Token must not be empty');
    }
    const enc = this.encrypt(trimmed);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { expoTokenEnc: enc, expoTokenSetAt: new Date() },
      select: { expoTokenSetAt: true },
    });
    return {
      set: true,
      hint: trimmed.length <= 4 ? '****' : `••••${trimmed.slice(-4)}`,
      setAt: updated.expoTokenSetAt?.toISOString(),
    };
  }

  async clearToken(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { expoTokenEnc: null, expoTokenSetAt: null },
    });
  }

  /** Returns the decrypted Expo token or `null` if none is set. */
  async getTokenPlaintext(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { expoTokenEnc: true },
    });
    if (!user?.expoTokenEnc) return null;
    try {
      return this.decrypt(user.expoTokenEnc);
    } catch (err) {
      this.logger.error(
        `Failed to decrypt Expo token for user ${userId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  private encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join('|');
  }

  private decrypt(envelope: string): string {
    const [ivB64, tagB64, ctB64] = envelope.split('|');
    if (!ivB64 || !tagB64 || !ctB64) {
      throw new Error('Malformed ciphertext envelope');
    }
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const ciphertext = Buffer.from(ctB64, 'base64');
    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
}

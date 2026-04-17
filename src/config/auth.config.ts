import { registerAs } from '@nestjs/config';

export default registerAs('auth', () => ({
  accessSecret: process.env.JWT_ACCESS_SECRET!,
  accessExpiration: process.env.JWT_ACCESS_EXPIRATION || '15m',
  refreshSecret: process.env.JWT_REFRESH_SECRET!,
  refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
  secretsEncryptionKey: process.env.SECRETS_ENCRYPTION_KEY!,
}));

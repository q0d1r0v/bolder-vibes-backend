import { registerAs } from '@nestjs/config';

export default registerAs('cors', () => ({
  allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim()),
}));

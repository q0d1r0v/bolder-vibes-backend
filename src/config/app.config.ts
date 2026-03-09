import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  name: process.env.APP_NAME || 'bolder-vibes',
  port: parseInt(process.env.APP_PORT!, 10) || 3000,
  debug: process.env.APP_DEBUG === 'true',
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
}));

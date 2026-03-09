import { Role } from '../enums/index.js';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
}

export interface JwtPayloadWithRefresh extends JwtPayload {
  refreshToken: string;
}

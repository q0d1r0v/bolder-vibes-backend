import { Request } from 'express';
import { Role } from '../enums/index.js';

export interface RequestUser {
  id: string;
  email: string;
  role: Role;
}

export interface RequestWithUser extends Request {
  user: RequestUser;
  requestId?: string;
}

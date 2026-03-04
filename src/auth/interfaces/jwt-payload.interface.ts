import { UserRole } from '@/common/enums/user-role.enum';

export interface JwtPayload {
  sub: string;
  email: string;
  displayName?: string | null;
  role: UserRole;
}

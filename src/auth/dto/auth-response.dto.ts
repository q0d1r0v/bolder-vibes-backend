import { ApiProperty } from '@nestjs/swagger';

import { UserRole } from '@/common/enums/user-role.enum';

export class AuthUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ required: false, nullable: true })
  displayName!: string | null;

  @ApiProperty({ enum: UserRole })
  role!: UserRole;
}

export class AuthResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  expiresIn!: string;

  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;
}

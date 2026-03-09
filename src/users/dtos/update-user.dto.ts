import { IsString, MaxLength, IsOptional, IsEnum } from 'class-validator';
import { Role } from '@/common/enums/index.js';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}

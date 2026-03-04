import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'builder@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'SuperSecret123' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

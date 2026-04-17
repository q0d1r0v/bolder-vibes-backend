import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

export class SetExpoTokenDto {
  @ApiProperty({
    description:
      'Expo personal access token (EXPO_TOKEN). Generate at https://expo.dev/accounts/[username]/settings/access-tokens.',
    minLength: 16,
    maxLength: 256,
  })
  @IsString()
  @MinLength(16)
  @MaxLength(256)
  token!: string;
}

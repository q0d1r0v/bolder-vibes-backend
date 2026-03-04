import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateChatDto {
  @ApiProperty({ example: 'Landing page prompt' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title!: string;
}

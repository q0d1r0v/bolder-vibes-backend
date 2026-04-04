import { IsString, MinLength, MaxLength } from 'class-validator';

export class CreateMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10000, {
    message: 'Message content must not exceed 10,000 characters',
  })
  content: string;
}

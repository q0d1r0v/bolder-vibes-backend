import { MessageRole } from '@/common/enums/message-role.enum';

export class CreateMessageDto {
  role!: MessageRole;
  content!: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

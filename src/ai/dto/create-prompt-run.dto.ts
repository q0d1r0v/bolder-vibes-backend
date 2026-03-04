export class CreatePromptRunDto {
  prompt!: string;
  chatId?: string;
  provider?: string;
  model?: string;
  requestedByEmail?: string;
  autoRecordUserMessage?: boolean;
}

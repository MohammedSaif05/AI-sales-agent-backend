import { Global, Module } from '@nestjs/common';
import { AIService } from './ai.service';
import { GeminiProvider } from './providers/gemini.provider';

@Global()
@Module({
  providers: [GeminiProvider, AIService],
  exports: [AIService],
})
export class AiModule {}

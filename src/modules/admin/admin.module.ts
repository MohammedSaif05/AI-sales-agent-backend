import { Module } from '@nestjs/common';
import { BusinessAnalystModule } from '../business-analyst/business-analyst.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [BusinessAnalystModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}

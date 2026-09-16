import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators/roles.decorator';
import { AppService } from './app.service';

@ApiTags('System')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'API Health Check',
    description: 'Returns system status',
  })
  @ApiResponse({ status: 200, description: 'API is running' })
  getHello() {
    return this.appService.getHello();
  }

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Detailed System Health Check' })
  @ApiResponse({ status: 200, description: 'System health metrics' })
  getHealth() {
    return {
      status: 'ok',
      service: 'AI Sales Assistant Backend',
      feature: 'Feature 01: Business Onboarding & Customer Management',
      timestamp: new Date().toISOString(),
    };
  }
}

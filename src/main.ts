import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Security Headers
  app.use(helmet());

  // Global Prefix
  const apiPrefix = configService.get<string>('API_PREFIX') || 'api/v1';
  app.setGlobalPrefix(apiPrefix);

  // CORS Configuration
  const corsOrigins = configService.get<string>('CORS_ORIGINS');
  const allowedOrigins = corsOrigins
    ? corsOrigins.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'];

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'Idempotency-Key',
      'x-request-id',
    ],
  });

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger / OpenAPI Specification
  const swaggerConfig = new DocumentBuilder()
    .setTitle('AI Sales Assistant API')
    .setDescription(
      `## Feature 01: Business Onboarding & Customer Management
Canonical backend API contract for:
- Business Owner Mobile Application
- Super Admin Dashboard

### Key Design Principles:
1. **Source of Truth**: All data models, validation rules, and error codes are authoritative here.
2. **Multi-Tenancy**: Every business record is isolated server-side.
3. **Staged Imports**: Upload -> Parse/Stage -> Preview -> Idempotent Confirm.
4. **Untrusted AI**: AI Vision outputs are strictly validated before persistence.
5. **No Assumed Consent**: Marketing preferences default to false until explicitly opted in.`,
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT Bearer access token',
        in: 'header',
      },
      'bearer',
    )
    .addTag('Authentication', 'Owner registration, login, multi-device sessions & token rotation')
    .addTag('Business Profile & Hours', 'Store information, Cloudflare R2 logo upload & 7-day schedule')
    .addTag('Customer Management', 'Customer CRUD, phone normalization, soft deletes & marketing consent')
    .addTag('Customer Imports', 'CSV, Excel and AI vision customer extraction with staged preview & idempotent confirm')
    .addTag('Super Admin', 'Platform metrics, cross-tenant business and customer inspection')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
    },
    customSiteTitle: 'AI Sales Assistant API Docs',
  });

  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port);

  logger.log(`🚀 Sales Assistant Backend running on http://localhost:${port}/${apiPrefix}`);
  logger.log(`📚 Swagger OpenAPI Documentation available at http://localhost:${port}/api/docs`);
}

bootstrap();

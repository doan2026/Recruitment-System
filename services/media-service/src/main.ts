import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { InternalAuthService } from './common/auth/internal-auth.service';
import { JwtVerifierService } from './common/auth/jwt-verifier.service';
import { PrismaService } from './prisma/prisma.service';
import { MediaCleanupScheduler } from './media/media-maintenance.service';
import { StorageProvider } from './storage/storage-provider';

export const configureApplication = (
  app: INestApplication,
): void => {
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    }),
  );

  const config = app.get(ConfigService);
  const allowedOrigins = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (allowedOrigins.length > 0) {
    app.enableCors({
      origin: allowedOrigins,
      credentials: true,
    });
  }

  const swaggerSetting = config
    .get<string>('SWAGGER_ENABLED')
    ?.trim()
    .toLowerCase();
  const nodeEnvironment = config
    .get<string>('NODE_ENV')
    ?.trim()
    .toLowerCase();
  const swaggerEnabled =
    swaggerSetting === 'true' ||
    (swaggerSetting === undefined &&
      nodeEnvironment !== 'production');

  if (swaggerEnabled) {
    const document = new DocumentBuilder()
      .setTitle('File/Media Service API')
      .setDescription(
        'Signed upload, canonical verification and file ownership API.',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .addServer('/files', 'API Gateway')
      .addServer('/', 'Direct service access')
      .build();
    SwaggerModule.setup(
      'docs',
      app,
      SwaggerModule.createDocument(app, document),
    );
  }
};

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApplication(app);

  const config = app.get(ConfigService);
  const port = Number(config.get<string>('PORT') ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  app.get(JwtVerifierService).assertConfiguration();
  app.get(InternalAuthService).assertConfiguration();
  app.get(StorageProvider).assertConfiguration();
  app.get(MediaCleanupScheduler).assertConfiguration();
  await app.get(PrismaService).$queryRaw`SELECT 1`;

  app.enableShutdownHooks();
  await app.listen(port, '0.0.0.0');
}

if (require.main === module) {
  void bootstrap();
}

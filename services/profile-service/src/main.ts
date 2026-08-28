import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { InternalAuthService } from './common/auth/internal-auth.service';

export const configureApplication = (
  app: NestExpressApplication,
): void => {
  // Builder content is capped at 1 MiB by DTO and PostgreSQL. Leave enough
  // envelope headroom so the HTTP parser does not impose a lower hidden cap.
  app.useBodyParser('json', { limit: 1_100_000 });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
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
      .setTitle('Profile Service API')
      .setDescription(
        'Candidate profile API. Gateway routes are exposed under /profile.',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .addServer('/profile', 'API Gateway')
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
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApplication(app);

  const config = app.get(ConfigService);
  const port = Number(config.get<string>('PORT') ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  app.get(InternalAuthService).assertConfiguration();
  app.enableShutdownHooks();
  await app.listen(port, '0.0.0.0');
}

if (require.main === module) {
  void bootstrap();
}

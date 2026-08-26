import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

export const configureApplication = (
  app: INestApplication,
): void => {
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
  const app = await NestFactory.create(AppModule);
  configureApplication(app);

  const config = app.get(ConfigService);
  const port = Number(config.get<string>('PORT') ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  app.enableShutdownHooks();
  await app.listen(port, '0.0.0.0');
}

if (require.main === module) {
  void bootstrap();
}

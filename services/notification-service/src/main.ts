import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { JwtVerifierService } from './auth/jwt-verifier.service';

export const configureApplication = (app: INestApplication): void => {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
    }),
  );

  const config = app.get(ConfigService);
  const allowedOrigins = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (allowedOrigins.length > 0) {
    app.enableCors({ origin: allowedOrigins, credentials: true });
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
    (swaggerSetting === undefined && nodeEnvironment !== 'production');
  if (swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Notification Service')
        .setDescription('Private notification inbox API.')
        .setVersion('1.0')
        .addBearerAuth()
        .addServer('/', 'API Gateway or direct service root')
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
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
  app.enableShutdownHooks();
  await app.listen(port, '0.0.0.0');
}

if (require.main === module) {
  void bootstrap();
}

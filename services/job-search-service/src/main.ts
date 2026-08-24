import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Job & Search Service API')
      .setVersion('1.0')
      .addBearerAuth()
      .addServer('/jobs', 'API Gateway')
      .addServer('/', 'Direct service')
      .build(),
  );
  SwaggerModule.setup('docs', app, document);
  app.enableShutdownHooks();
  await app.listen(
    Number(config.get<string>('PORT') ?? '3000'),
    '0.0.0.0',
  );
}

void bootstrap();

import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
@Controller() class MediaController { @Get('health') health() { return { service: 'media-service', status: 'UP' }; } }
@Module({ controllers: [MediaController] }) class MediaModule {}
async function bootstrap() { const app = await NestFactory.create(MediaModule); await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0'); }
bootstrap();

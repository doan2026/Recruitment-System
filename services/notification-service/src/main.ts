import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
@Controller() class NotificationController { @Get('health') health() { return { service: 'notification-service', status: 'UP' }; } }
@Module({ controllers: [NotificationController] }) class NotificationModule {}
async function bootstrap() { const app = await NestFactory.create(NotificationModule); await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0'); }
bootstrap();

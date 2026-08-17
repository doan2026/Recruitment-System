import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
@Controller() class ProfileController { @Get('health') health() { return { service: 'profile-service', status: 'UP' }; } }
@Module({ controllers: [ProfileController] }) class ProfileModule {}
async function bootstrap() { const app = await NestFactory.create(ProfileModule); await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0'); }
bootstrap();

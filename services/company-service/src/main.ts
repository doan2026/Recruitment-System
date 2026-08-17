import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
@Controller() class CompanyController { @Get('health') health() { return { service: 'company-service', status: 'UP' }; } }
@Module({ controllers: [CompanyController] }) class CompanyModule {}
async function bootstrap() { const app = await NestFactory.create(CompanyModule); await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0'); }
bootstrap();

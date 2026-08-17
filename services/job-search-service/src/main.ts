import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
@Controller() class JobController { @Get('health') health() { return { service: 'job-search-service', status: 'UP' }; } }
@Module({ controllers: [JobController] }) class JobModule {}
async function bootstrap() { const app = await NestFactory.create(JobModule); await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0'); }
bootstrap();

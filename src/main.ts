import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from './interfaces/http/filters/domain-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new DomainExceptionFilter());
  const port = Number(Bun.env.PORT ?? '3000');
  await app.listen(port, '0.0.0.0');
}

bootstrap();
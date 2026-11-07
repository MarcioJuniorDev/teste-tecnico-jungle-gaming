import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConsumersModule } from './consumers.module';
import { SqsConsumerService } from './sqs-consumer.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(ConsumersModule);
  const consumer = app.get(SqsConsumerService);
  consumer.start();
  console.log('SQS consumer running');

  const shutdown = async (signal: string) => {
    console.log(`received ${signal}, shutting down...`);
    await consumer.shutdown();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap();
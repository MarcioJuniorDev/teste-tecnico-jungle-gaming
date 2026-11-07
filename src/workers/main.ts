import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkersModule } from './workers.module';
import { OutboxPublisherService } from './outbox-publisher.service';
import { PendingReferenceWorker } from './pending-reference.worker';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkersModule);
  const publisher = app.get(OutboxPublisherService);
  const worker = app.get(PendingReferenceWorker);
  publisher.start();
  worker.start();
  console.log('Workers running (outbox publisher + pending reference)');

  const shutdown = async (signal: string) => {
    console.log(`received ${signal}, shutting down...`);
    await publisher.shutdown();
    await worker.shutdown();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap();
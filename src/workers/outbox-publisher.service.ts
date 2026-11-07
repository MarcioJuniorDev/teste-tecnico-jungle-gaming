import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  Inject,
} from '@nestjs/common';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { UNIT_OF_WORK } from '../application/ports/unit-of-work';
import type { UnitOfWork } from '../application/ports/unit-of-work';
import { MetricsService } from '../infra/observability/metrics.service';

const BATCH_SIZE = 20;
const SLEEP_MS = 2000;

@Injectable()
export class OutboxPublisherService implements OnApplicationShutdown {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private readonly client: SQSClient;
  private readonly queueUrl: string;
  private running = false;
  private loop: Promise<void> | null = null;

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {
    this.client = new SQSClient({
      endpoint: process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566',
      region: process.env.AWS_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
      },
    });
    this.queueUrl =
      process.env.SQS_EVENTS_QUEUE_URL ??
      'http://localhost:4566/000000000000/wager-events';
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.runLoop();
  }

  async shutdown(): Promise<void> {
    this.running = false;
    if (this.loop) await this.loop;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.shutdown();
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        const processed = await this.publishBatch();
        if (processed === 0) {
          await this.sleep(SLEEP_MS);
        }
      } catch (err) {
        this.logger.error(`publish loop error: ${(err as Error).message}`);
        await this.sleep(SLEEP_MS);
      }
    }
  }

  private async publishBatch(): Promise<number> {
    return this.uow.run(async (repos) => {
      const batch = await repos.outbox.lockPendingBatch(BATCH_SIZE);
      if (batch.length === 0) return 0;

      const oldest = batch[0];
      this.metrics.outboxLagSeconds.set(
        (Date.now() - oldest.occurredAt.getTime()) / 1000,
      );

      for (const message of batch) {
        try {
          await this.client.send(
            new SendMessageCommand({
              QueueUrl: this.queueUrl,
              MessageBody: JSON.stringify(message.payload),
            }),
          );
          await repos.outbox.markPublished(message.id);
        } catch (err) {
          this.logger.error(
            `publish failed for ${message.id}: ${(err as Error).message}`,
          );
          this.metrics.retriesTotal.inc({ source: 'publisher' });
          const attempts = message.attempts + 1;
          const backoffMs = Math.min(5000 * Math.pow(2, attempts - 1), 300_000);
          await repos.outbox.scheduleRetry(
            message.id,
            attempts,
            new Date(Date.now() + backoffMs),
          );
        }
      }
      return batch.length;
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
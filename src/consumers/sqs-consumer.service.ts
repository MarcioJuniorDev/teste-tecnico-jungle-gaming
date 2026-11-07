import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  Inject,
} from '@nestjs/common';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { ProcessWagerTransactionUseCase } from '../application/use-cases/process-wager-transaction/process-wager-transaction.use-case';
import { IdempotencyConflictError } from '../application/use-cases/process-wager-transaction/process-wager-transaction.errors';
import { MetricsService } from '../infra/observability/metrics.service';
import { SqsMessage } from './sqs-message';
import { classifyError, classifyResult } from './error-classifier';
import { visibilityForAttempt } from './backoff';
import { WagerTransactionKind } from '../domain/wagering/wager-transaction-kind';

const CONSUMER_NAME = 'wager-consumer';
const MAX_CONCURRENT = 5;
const WAIT_TIME_SECONDS = 20;
const MAX_MESSAGES = 10;

@Injectable()
export class SqsConsumerService implements OnApplicationShutdown {
  private readonly logger = new Logger(SqsConsumerService.name);
  private readonly client: SQSClient;
  private readonly queueUrl: string;
  private running = false;
  private shuttingDown = false;
  private inFlight = 0;
  private loop: Promise<void> | null = null;

  constructor(
    @Inject(ProcessWagerTransactionUseCase)
    private readonly useCase: ProcessWagerTransactionUseCase,
    @Inject(MetricsService)
    private readonly metrics: MetricsService,
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
      process.env.SQS_QUEUE_URL ??
      'http://localhost:4566/000000000000/wager-transactions.fifo';
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.runLoop();
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.running = false;
    if (this.loop) await this.loop;
    const deadline = Date.now() + 10_000;
    while (this.inFlight > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.shutdown();
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        const response = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: MAX_MESSAGES,
            WaitTimeSeconds: WAIT_TIME_SECONDS,
            VisibilityTimeout: 30,
            MessageSystemAttributeNames: ['ApproximateReceiveCount'],
          }),
        );
        const messages = response.Messages ?? [];
        if (messages.length === 0) continue;

        const batches: Array<typeof messages> = [];
        for (let i = 0; i < messages.length; i += MAX_CONCURRENT) {
          batches.push(messages.slice(i, i + MAX_CONCURRENT));
        }
        for (const batch of batches) {
          await Promise.all(batch.map((m) => this.handleMessage(m)));
        }
      } catch (err) {
        this.logger.error(`receive error: ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async handleMessage(raw: {
    Body?: string;
    ReceiptHandle?: string;
    MessageId?: string;
    Attributes?: Record<string, string>;
  }): Promise<void> {
    this.inFlight++;
    const startedAt = Date.now();
    try {
      const body = raw.Body;
      if (!body) {
        await this.ack(raw.ReceiptHandle);
        return;
      }

      let parsed: SqsMessage;
      try {
        parsed = JSON.parse(body) as SqsMessage;
      } catch {
        this.logger.error(`malformed message: ${raw.MessageId}`);
        await this.nack(raw.ReceiptHandle, raw.Attributes, 'permanent');
        return;
      }

      if (parsed.type !== 'WagerTransactionRequested') {
        this.logger.warn(`unknown message type: ${parsed.type}`);
        await this.ack(raw.ReceiptHandle);
        return;
      }

      if (parsed.data.kind === WagerTransactionKind.Opening) {
        this.logger.error(
          `OPENING cannot be submitted via queue: ${raw.MessageId}`,
        );
        await this.nack(raw.ReceiptHandle, raw.Attributes, 'permanent');
        return;
      }

      const result = await this.useCase.execute({
        providerId: parsed.data.providerId,
        externalTransactionId: parsed.data.externalTransactionId,
        idempotencyKey: parsed.data.idempotencyKey,
        playerId: parsed.data.playerId,
        walletId: parsed.data.walletId,
        roundId: parsed.data.roundId,
        gameId: parsed.data.gameId,
        kind: parsed.data.kind,
        money: parsed.data.money,
        referenceExternalTransactionId:
          parsed.data.referenceExternalTransactionId,
        inbox: { consumerName: CONSUMER_NAME, messageId: parsed.messageId },
        correlationId: parsed.messageId,
      });

      const elapsed = (Date.now() - startedAt) / 1000;
      this.metrics.processingDuration.observe(
        { operation: 'consumer' },
        elapsed,
      );
      this.metrics.transactionsTotal.inc({ status: result.status });
      if (result.idempotentReplay) this.metrics.duplicatesTotal.inc();

      classifyResult(result); // sempre ack
      await this.ack(raw.ReceiptHandle);
    } catch (err) {
      const kind = classifyError(err);
      if (kind === 'transient') {
        this.metrics.retriesTotal.inc({ source: 'consumer' });
      }
      if (err instanceof IdempotencyConflictError) {
        this.metrics.idempotencyConflictsTotal.inc();
      }
      this.logger.error(
        `message ${raw.MessageId} failed (${kind}): ${(err as Error).message}`,
      );
      await this.nack(raw.ReceiptHandle, raw.Attributes, kind);
    } finally {
      this.inFlight--;
    }
  }

  private async ack(receiptHandle?: string): Promise<void> {
    if (!receiptHandle) return;
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  private async nack(
    receiptHandle: string | undefined,
    attributes: Record<string, string> | undefined,
    kind: 'transient' | 'permanent',
  ): Promise<void> {
    if (!receiptHandle) return;
    if (kind === 'permanent') {
      return;
    }
    const receiveCount = Number(attributes?.ApproximateReceiveCount ?? '1');
    const visibility = visibilityForAttempt(receiveCount);
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: visibility,
      }),
    );
  }
}
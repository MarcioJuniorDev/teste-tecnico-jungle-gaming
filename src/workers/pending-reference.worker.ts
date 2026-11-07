import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  Inject,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { UNIT_OF_WORK } from '../application/ports/unit-of-work';
import type { UnitOfWork } from '../application/ports/unit-of-work';
import { ProcessWagerTransactionUseCase } from '../application/use-cases/process-wager-transaction/process-wager-transaction.use-case';
import { WagerTransactionStatus } from '../domain/wagering/wager-transaction-status';
import { WagerTransaction } from '../domain/wagering/wager-transaction';
import { WagerTransactionEntity } from '../infra/persistence/entities/wager-transaction.entity';
import { WagerTransactionMapper } from '../infra/persistence/mappers/wager-transaction.mapper';
import { FailureCode } from '../domain/wagering/failure-code';
import { OutboxMessage } from '../domain/messaging/outbox-message';
import { WagerTransactionRejected } from '../domain/wagering/events/wager-transaction-rejected';

const SLEEP_MS = 30_000;
const MAX_ATTEMPTS = 8;
const TTL_MS = 15 * 60 * 1000;

@Injectable()
export class PendingReferenceWorker implements OnApplicationShutdown {
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private running = false;
  private loop: Promise<void> | null = null;

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(ProcessWagerTransactionUseCase)
    private readonly useCase: ProcessWagerTransactionUseCase,
  ) {}

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
        await this.processBatch();
      } catch (err) {
        this.logger.error(
          `pending-reference loop error: ${(err as Error).message}`,
        );
      }
      await this.sleep(SLEEP_MS);
    }
  }

  private async processBatch(): Promise<void> {
    const rows = await this.uow.run(async (_repos, em) => {
      return em.find(
        WagerTransactionEntity,
        {
          status: WagerTransactionStatus.PendingReference,
          $or: [
            { nextAttemptAt: null },
            { nextAttemptAt: { $lte: new Date() } },
          ],
        },
        { limit: 20, orderBy: { nextAttemptAt: 'asc' } },
      );
    });

    for (const row of rows) {
      await this.reprocess(row);
    }
  }

  private async reprocess(row: WagerTransactionEntity): Promise<void> {
    const tx = WagerTransactionMapper.toDomain(row);
    const attempts = row.attempts + 1;
    const ageMs = Date.now() - tx.createdAt.getTime();

    if (attempts > MAX_ATTEMPTS || ageMs > TTL_MS) {
      this.logger.warn(
        `pending-reference ${tx.id} expired (attempts=${attempts})`,
      );
      await this.expire(tx);
      return;
    }

    try {
      const result = await this.useCase.execute({
        providerId: tx.providerId,
        externalTransactionId: tx.externalTransactionId,
        idempotencyKey: tx.idempotencyKey,
        playerId: tx.playerId,
        walletId: tx.walletId,
        roundId: tx.roundId,
        gameId: tx.gameId,
        kind: tx.kind,
        money: tx.money.toJSON(),
        referenceExternalTransactionId: tx.referenceExternalTransactionId,
        correlationId: tx.id,
        reprocess: true,
      });

      this.logger.log(
        `pending-reference ${tx.id} reprocessed: ${result.status}`,
      );
    } catch (err) {
      this.logger.error(
        `pending-reference ${tx.id} failed: ${(err as Error).message}`,
      );
    }
  }

  private async expire(tx: WagerTransaction): Promise<void> {
    await this.uow.run(async (repos) => {
      const entity = await repos.transactions.findById(tx.id);
      if (!entity) return;
      if (entity.status !== WagerTransactionStatus.PendingReference) return;
      entity.reject(FailureCode.ReferenceNotFound);
      await repos.transactions.save(entity);
      await repos.outbox.save(
        OutboxMessage.enqueue(
          WagerTransactionRejected.from(entity, FailureCode.ReferenceNotFound, {
            eventId: randomUUID(),
            correlationId: entity.id,
            causationId: entity.id,
            occurredAt: new Date(),
          }),
        ),
      );
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
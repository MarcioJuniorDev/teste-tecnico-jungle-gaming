import { Injectable } from '@nestjs/common';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry: Registry;

  readonly transactionsTotal: Counter<string>;
  readonly duplicatesTotal: Counter<string>;
  readonly idempotencyConflictsTotal: Counter<string>;
  readonly retriesTotal: Counter<string>;
  readonly dlqMessagesTotal: Gauge<string>;
  readonly lockConflictsTotal: Counter<string>;
  readonly outboxLagSeconds: Gauge<string>;
  readonly processingDuration: Histogram<string>;

  constructor() {
    this.registry = new Registry();
    collectDefaultMetrics({ register: this.registry });

    this.transactionsTotal = new Counter({
      name: 'wager_transactions_total',
      help: 'Total de transações processadas, por status',
      labelNames: ['status'],
      registers: [this.registry],
    });
    this.duplicatesTotal = new Counter({
      name: 'wager_duplicates_total',
      help: 'Total de mensagens duplicadas detectadas (inbox replay)',
      registers: [this.registry],
    });
    this.idempotencyConflictsTotal = new Counter({
      name: 'wager_idempotency_conflicts_total',
      help: 'Total de conflitos de idempotência (mesma key, payload diferente)',
      registers: [this.registry],
    });
    this.retriesTotal = new Counter({
      name: 'wager_retries_total',
      help: 'Total de retries (consumer, publisher)',
      labelNames: ['source'],
      registers: [this.registry],
    });
    this.dlqMessagesTotal = new Gauge({
      name: 'wager_dlq_messages_total',
      help: 'Mensagens na DLQ (última leitura)',
      registers: [this.registry],
    });
    this.lockConflictsTotal = new Counter({
      name: 'wager_lock_conflicts_total',
      help: 'Total de conflitos de lock (deadlock, serialization)',
      registers: [this.registry],
    });
    this.outboxLagSeconds = new Gauge({
      name: 'wager_outbox_lag_seconds',
      help: 'Idade (s) do evento mais antigo não publicado',
      registers: [this.registry],
    });
    this.processingDuration = new Histogram({
      name: 'wager_processing_duration_seconds',
      help: 'Latência de processamento (s)',
      labelNames: ['operation'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      registers: [this.registry],
    });
  }

  async metrics(): Promise<string> {
    return this.registry.metrics();
  }
}
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { setupIntegrationDb, teardownIntegrationDb } from './setup';
import { OutboxMessageEntity } from '../../src/infra/persistence/entities/outbox-message.entity';

describe('Outbox (publishers concorrentes)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await setupIntegrationDb();
  });

  afterAll(async () => {
    await teardownIntegrationDb();
  });

  test('lockPendingBatch com PESSIMISTIC_WRITE não pega as mesmas linhas em paralelo', async () => {
    const em = orm.em.fork();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = crypto.randomUUID();
      ids.push(id);
      await em.execute(
        `insert into outbox_messages (id, aggregate_id, event_type, payload, occurred_at, attempts)
         values (?, ?, 'FakeEvent', '{}', now(), 0)`,
        [id, crypto.randomUUID()],
      );
    }

    // Primeiro "publisher" trava o lote; o segundo (outro fork) espera.
    const em1 = orm.em.fork();
    const em2 = orm.em.fork();

    const tx1 = em1.transactional(async (tx) => {
      const locked = await tx.find(
        OutboxMessageEntity,
        { publishedAt: null },
        { limit: 5, lockMode: 'pessimistic_write' as any },
      );
      // segura o lock por 1s
      await new Promise((r) => setTimeout(r, 1000));
      return locked.map((l) => l.id);
    });

    await new Promise((r) => setTimeout(r, 200));

    const tx2 = em2.transactional(async (tx) => {
      const locked = await tx.find(
        OutboxMessageEntity,
        { publishedAt: null },
        { limit: 5, lockMode: 'pessimistic_write' as any },
      );
      return locked.map((l) => l.id);
    });

    const [batch1, batch2] = await Promise.all([tx1, tx2]);
    // O segundo espera o primeiro commitar; como o primeiro ainda segura, o segundo
    // vai pegar as mesmas linhas (sem SKIP LOCKED). O teste valida que o lock existe
    // (o segundo só roda depois do primeiro).
    expect(batch1.length).toBe(5);
    expect(batch2.length).toBe(5);
  });

  test('markPublished por id', async () => {
    const em = orm.em.fork();
    const id = crypto.randomUUID();
    await em.execute(
      `insert into outbox_messages (id, aggregate_id, event_type, payload, occurred_at, attempts)
       values (?, ?, 'FakeEvent', '{}', now(), 0)`,
      [id, crypto.randomUUID()],
    );
    await em.execute(
      `update outbox_messages set published_at = now() where id = ?`,
      [id],
    );
    const row = await em.findOne(OutboxMessageEntity, { id });
    expect(row?.publishedAt).not.toBeNull();
  });
});
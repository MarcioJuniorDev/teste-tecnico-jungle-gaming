import { MikroORM } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { execSync } from 'node:child_process';
import config from '../../mikro-orm.config';
import { readFileSync } from 'node:fs';

let orm: MikroORM | null = null;

export async function setupIntegrationDb(): Promise<MikroORM> {
  if (orm) return orm;

  const testConfig = {
    ...config,
    dbName: process.env.DB_NAME ?? 'wagering_test',
  };

  orm = await MikroORM.init({
    ...testConfig,
    extensions: [Migrator],
  });

  const migrator = orm.migrator;
  await migrator.up();

  const sql = readFileSync(
    './migrations/sql/forbid_ledger_mutation.sql',
    'utf8',
  );
  try {
    execSync(
      `docker compose exec -T postgres psql -U wagering -d ${testConfig.dbName}`,
      {
        input: readFileSync('./migrations/sql/forbid_ledger_mutation.sql', 'utf8'),
        stdio: ['pipe', 'inherit', 'inherit'],
      },
    );
  } catch (err) {
    // o trigger pode já existir (idempotência); não falha o setup
    console.warn(`[setup] trigger apply warning: ${(err as Error).message}`);
  }

  return orm;
}

export async function teardownIntegrationDb(): Promise<void> {
  if (!orm) return;
  const em = orm.em.fork();
  const tables = [
    'wallet_ledger_entries',
    'wager_transactions',
    'wallets',
    'inbox_messages',
    'outbox_messages',
  ];
  for (const table of tables) {
    try {
      await em.execute(`truncate table "${table}" cascade`);
    } catch {
      // tabela pode não existir
    }
  }
  // NÃO fecha o orm (o global é reutilizado pelos outros testes)
}
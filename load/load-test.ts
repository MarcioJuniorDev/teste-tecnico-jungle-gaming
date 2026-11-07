import { randomUUID } from 'node:crypto';

const BASE_URL = process.env.LOAD_BASE_URL ?? 'http://localhost:3000';
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? '50');
const DURATION_SECONDS = Number(process.env.LOAD_DURATION ?? '30');
const PLAYER_POOL = Number(process.env.LOAD_PLAYERS ?? '100');
const WALLETS_PER_PLAYER = 1;

interface Sample {
  status: number;
  durationMs: number;
  idempotentReplay: boolean;
  error?: string;
}

const samples: Sample[] = [];
let stop = false;

async function createWallet(playerId: string): Promise<string> {
  const body = {
    playerId,
    initialBalance: { amount: '1000.00', currency: 'BRL' },
  };
  const res = await fetch(`${BASE_URL}/wallets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`createWallet ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { id: string };
  return json.id;
}

async function submitBet(walletId: string, playerId: string, externalId: string): Promise<Sample> {
  const started = performance.now();
  try {
    const body = {
      providerId: 'provider-a',
      externalTransactionId: externalId,
      playerId,
      walletId,
      roundId: `round-${externalId}`,
      gameId: 'fortune-chimp',
      kind: 'BET',
      money: { amount: '1.00', currency: 'BRL' },
    };
    const res = await fetch(`${BASE_URL}/wagering/transactions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': `provider-a:${externalId}`,
      },
      body: JSON.stringify(body),
    });
    const durationMs = performance.now() - started;
    const json = res.ok ? ((await res.json()) as { idempotentReplay?: boolean }) : {};
    return {
      status: res.status,
      durationMs,
      idempotentReplay: Boolean(json.idempotentReplay),
    };
  } catch (err) {
    return {
      status: 0,
      durationMs: performance.now() - started,
      idempotentReplay: false,
      error: (err as Error).message,
    };
  }
}

async function worker(wallets: Array<{ walletId: string; playerId: string }>): Promise<void> {
  while (!stop) {
    const target = wallets[Math.floor(Math.random() * wallets.length)];
    const externalId = randomUUID();
    const sample = await submitBet(target.walletId, target.playerId, externalId);
    samples.push(sample);
  }
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx];
}

async function main(): Promise<void> {
  console.log(`Load test: ${CONCURRENCY} workers, ${DURATION_SECONDS}s, ${PLAYER_POOL} players`);

  // 1. Cria wallets (uma por player)
  const wallets: Array<{ walletId: string; playerId: string }> = [];
  for (let i = 0; i < PLAYER_POOL; i++) {
    const playerId = randomUUID();
    try {
      const walletId = await createWallet(playerId);
      wallets.push({ walletId, playerId });
    } catch (err) {
      console.error(`createWallet failed: ${(err as Error).message}`);
    }
  }
  console.log(`Created ${wallets.length}/${PLAYER_POOL} wallets`);

  // 2. Dispara os workers
  const workers = Array.from({ length: CONCURRENCY }, () => worker(wallets));
  const timer = setTimeout(() => {
    stop = true;
  }, DURATION_SECONDS * 1000);
  await Promise.all(workers);
  clearTimeout(timer);

  // 3. Calcula as métricas
  const total = samples.length;
  const ok = samples.filter((s) => s.status >= 200 && s.status < 300).length;
  const errors = samples.filter((s) => s.status === 0 || s.status >= 500).length;
  const businessRejections = samples.filter((s) => s.status === 422).length;
  const replays = samples.filter((s) => s.idempotentReplay).length;
  const durations = samples.map((s) => s.durationMs);
  const throughput = total / DURATION_SECONDS;

  console.log('\n--- Resultados ---');
  console.log(`Total: ${total}`);
  console.log(`Sucesso (2xx): ${ok}`);
  console.log(`Erros (0/5xx): ${errors}`);
  console.log(`Rejeições de negócio (422): ${businessRejections}`);
  console.log(`Replays (idempotentReplay): ${replays}`);
  console.log(`Throughput: ${throughput.toFixed(2)} req/s`);
  console.log(`Latência p50: ${percentile(durations, 50).toFixed(2)} ms`);
  console.log(`Latência p95: ${percentile(durations, 95).toFixed(2)} ms`);
  console.log(`Latência p99: ${percentile(durations, 99).toFixed(2)} ms`);

  // 4. Outbox lag (via banco)
  try {
    const { execSync } = await import('node:child_process');
    const out = execSync(
      `docker compose exec -T postgres psql -U wagering -d wagering -t -c "select coalesce(max(extract(epoch from (now() - occurred_at))), 0) from outbox_messages where published_at is null;"`,
      { encoding: 'utf8', shell: 'powershell.exe' },
    ).trim();
    console.log(`Outbox lag (s): ${out}`);
  } catch (err) {
    console.warn(`outbox lag failed: ${(err as Error).message}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
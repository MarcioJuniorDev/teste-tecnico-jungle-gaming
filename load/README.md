# Teste de carga

## Metodologia

- **Ferramenta**: script próprio (`load/load-test.ts`, Bun + `fetch`), sem k6.
- **Ambiente**: Docker Compose local (Postgres + LocalStack + app). 3 instâncias da app (`--scale app=3`).
- **Carga**: `CONCURRENCY` workers (default 50) submetendo `BET` de `1.00` BRL para `PLAYER_POOL` wallets (default 100), por `DURATION_SECONDS` (default 30s).
- **Métrica**: latência por request (`performance.now()`), throughput, p50/p95/p99, taxa de erro, rejeições de negócio, outbox lag.

## Como rodar

```powershell
docker compose up -d --scale app=3
bun run load
# Distributed Wagering Processor

Serviço NestJS para processamento distribuído de apostas, com PostgreSQL, MikroORM, LocalStack e SQS.

## Pré-requisitos

- [Bun](https://bun.sh) 1.4+
- Docker Desktop + Docker Compose
- PowerShell (Windows) ou shell equivalente

## Instalação do Bun

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
bun --version
```

## Dependências

```powershell
bun add @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjs
bun add @mikro-orm/core @mikro-orm/nestjs @mikro-orm/postgresql @mikro-orm/migrations
bun add decimal.js @aws-sdk/client-sqs pino nestjs-pino prom-client zod
bun add -d typescript @types/bun @mikro-orm/cli
bun add -d @types/express@4
bun add -d pino-pretty
```

> `@types/express@4` (devDependency) é necessário porque o `DomainExceptionFilter` e o `HealthController` tipam a response com `Response` do Express, e o `@nestjs/platform-express` usa Express 4 (o `@types/express@5` é incompatível).

> `pino-pretty` (devDependency) formata os logs em dev (o `nestjs-pino` usa o `transport` para pretty; em produção, logs JSON puros).

## Infraestrutura (Docker)

Sobe PostgreSQL (porta 5432) e LocalStack (porta 4566) com healthchecks e volumes persistentes:

```powershell
docker compose up -d
docker compose ps
```

O script `infra/localstack-init.sh` cria as filas `wager-transactions.fifo`, `wager-transactions-dlq.fifo` e `wager-events`, com redrive da fila principal para a DLQ após 5 tentativas.

## Banco de dados

### Migrations

```powershell
bun run migration:create   # gera nova migration a partir do diff das entidades
bun run migration:up       # aplica migrations pendentes
bun run migration:down     # reverte a última migration
```

A migration inicial (`20261106013011`) cria as tabelas; a migration `20261106020000_add_invariants` adiciona as constraints (`CHECK`, `FOREIGN KEY`, índice único parcial de reversão).

### Trigger de imutabilidade do ledger

O trigger `wallet_ledger_entries_immutable` e a função `forbid_ledger_mutation()` são aplicados **fora** das migrations, via `psql`, porque o runner do MikroORM v7 separa statements por `;` e quebra blocos PL/pgSQL delimitados por `$$`. O SQL versionado está em `migrations/sql/forbid_ledger_mutation.sql`:

```powershell
Get-Content .\migrations\sql\forbid_ledger_mutation.sql | docker compose exec -T postgres psql -U wagering -d wagering
```

**Aplicar após `bun run migration:up`.** Limitação conhecida; ver `ARCHITECTURE.md`.

### Camada de persistência

Repositórios como portas (`src/application/ports/`) e implementações MikroORM (`src/infra/persistence/repositories/`), registrados no `PersistenceModule` via tokens `Symbol`. O `WalletRepository.findByIdForUpdate` usa `LockMode.PESSIMISTIC_WRITE` (lock por linha da wallet).

O `MikroOrmModule.forRoot(config)` inicializa o ORM no boot; o `entities` aponta para `src/infra/persistence/entities/**` (Bun transpila TS direto, sem `dist/`). O fork por request é automático (`@mikro-orm/nestjs`).

### Caso de uso central

`ProcessWagerTransactionUseCase` (`src/application/use-cases/process-wager-transaction/`) processa uma transação de aposta numa única transação SQL:

1. Inbox (quando origem SQS) — deduplica por `(consumerName, messageId)`.
2. Idempotência por `(providerId, idempotencyKey)` — replay se hash igual, conflito se diferente.
3. Insere a transação em `PENDING`; corrida de `UNIQUE` relê e classifica.
4. Lock da wallet (`findByIdForUpdate`).
5. `WagerPolicy.evaluate` decide `PROCESS` / `REJECT` / `PENDING_REFERENCE`.
6. Aplica (ledger + wallet) e enfileira eventos na outbox — tudo na mesma transação.
7. Marca o inbox como processado.

O `payloadHash` é SHA-256 do JSON canônico de `{ providerId, externalTransactionId, playerId, walletId, roundId, gameId, kind, money }`.

### Health checks

O `GET /health/ready` verifica:
- **PG**: `select 1` via `EntityManager`.
- **SQS**: `GetQueueAttributes` na fila `wager-transactions.fifo` (timeout 2s).

Configuração via env (defaults do LocalStack): `AWS_ENDPOINT_URL`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SQS_QUEUE_URL`.

### Outbox publisher

O publisher usa `markPublished(id)` e `scheduleRetry(id, attempts, nextAttemptAt)` — `UPDATE` direto por id, sem depender do `save` robusto (que conflitava com o `markPublished` do domínio). O `lockPendingBatch` usa `lockMode: PESSIMISTIC_WRITE` (trava as linhas; um publisher por vez). Múltiplos publishers concorrentes exigem SQL cru com `FOR UPDATE SKIP LOCKED` (limitação conhecida; Fase 12).

## Endpoints

### Escrita

- `POST /wallets` — cria wallet; saldo inicial > 0 gera `OPENING` + ledger `CREDIT` + outbox, na mesma transação. `201` no sucesso, `409` se `(playerId, currency)` já existe.
- `POST /wagering/transactions` — submete transação de aposta. Header `Idempotency-Key` obrigatório (`422` se ausente). Chama `ProcessWagerTransactionUseCase`.
  - `201` processado (primeira vez), com `{ transactionId, status, balance, idempotentReplay: false }`.
  - `200` replay (mesma key, mesmo payload), com `idempotentReplay: true`.
  - `202` `PENDING_REFERENCE`.
  - `422` rejeição de negócio, com `failureCode`.
  - `409` conflito de idempotência (mesma key, payload diferente).
  - `400` payload inválido (validação zod).

### Leitura

- `GET /wallets/:id` — wallet; `404 WALLET_NOT_FOUND` se não existir.
- `GET /wallets/:id/ledger?cursor=...&limit=50` — lançamentos paginados; cursor opaco (base64 de `{ createdAt, id }`); `limit` default 50, max 100; resposta com `items` e `nextCursor`.
- `GET /wagering/transactions/:id` — transação; `404 TRANSACTION_NOT_FOUND`.
- `GET /providers/:providerId/wagering/transactions/:externalTransactionId` — transação por provider + id externo.

### Reconciliação

- `POST /wallets/:id/reconciliation` — soma do ledger vs `wallet.balance`; retorna `{ storedBalance, calculatedBalance, difference, consistent, checkedEntries }`. Divergência → `consistent: false` (log + métrica; não corrige).

### Health

- `GET /health/live` — `200 { status: 'ok' }` (processo vivo).
- `GET /health/ready` — `200` se PG e SQS respondem; `503` se algum falha, com `{ status, checks: { db, sqs } }`.

### Métricas

- `GET /metrics` — expõe as métricas Prometheus (texto). Não exige autenticação.

### Mapeamento HTTP

| Código | Situação |
|---|---|
| 400 | Payload inválido (`VALIDATION_FAILED`) |
| 404 | Wallet/transação inexistente (`WALLET_NOT_FOUND`/`TRANSACTION_NOT_FOUND`) |
| 409 | Conflito de idempotência (`IDEMPOTENCY_CONFLICT`) ou wallet duplicada (`WALLET_ALREADY_EXISTS`) |
| 201 | Processado, primeira vez |
| 200 | Replay ou leitura |
| 202 | Pendente (`PENDING_REFERENCE`) |
| 422 | Rejeição de negócio (`BUSINESS_REJECTION` com `failureCode`) |
| 503 | `ready` com dependência fora |

## Consumidor SQS

O consumer roda em **processo separado** (`bun run consumer`), consumindo a fila `wager-transactions.fifo`:

- **Long polling** (`waitTimeSeconds: 20`, `maxNumberOfMessages: 10`), processamento paralelo com concorrência 5.
- **Reuso do `ProcessWagerTransactionUseCase`**, passando `inbox: { consumerName: 'wager-consumer', messageId }`.
- **Deduplicação por inbox persistente** (`PRIMARY KEY (consumer_name, message_id)`); redelivery de mensagem já processada devolve replay sem novo efeito.
- **Ack só após o commit**.
- **Classificação de erros**:
  - Negócio (`REJECTED`/`PENDING_REFERENCE`) → ack.
  - Transitório (PG fora, deadlock, timeout, serialização) → não ack + `ChangeMessageVisibility` com backoff exponencial (30s→5min).
  - Permanente (mensagem malformada, `OPENING`) → não ack; o SQS move para a DLQ após `maxReceiveCount: 5`.
- **Graceful shutdown** (SIGTERM/SIGINT): para o loop, aguarda até 10s as mensagens em andamento, devolve visibilidade das restantes.

### Enviar mensagem de teste (via `file://`, para preservar as aspas)

O `--message-body` inline no PowerShell remove as aspas do JSON. Grave o corpo num arquivo e use `file://`:

```powershell
$messageBody = '{"messageId":"msg-1","type":"WagerTransactionRequested","occurredAt":"2026-11-07T00:00:00.000Z","data":{"providerId":"provider-a","externalTransactionId":"ext-1","idempotencyKey":"provider-a:ext-1","playerId":"...","walletId":"...","roundId":"round-1","gameId":"game-1","kind":"BET","money":{"amount":"10.00","currency":"BRL"}}}'
Set-Content -Path .\msg.json -Value $messageBody -Encoding utf8 -NoNewline
docker compose cp .\msg.json localstack:/tmp/msg.json
docker compose exec localstack awslocal sqs send-message --queue-url http://localhost:4566/000000000000/wager-transactions.fifo --message-body file:///tmp/msg.json --message-group-id "<walletId>" --message-deduplication-id "msg-1"
```

## Workers

Os workers rodam em **processo separado** (`bun run workers`), sem HTTP:

- **Outbox publisher**: loop contínuo (sleep 2s quando não há mensagens). Seleciona até 20 mensagens pendentes (`published_at IS NULL`, `next_attempt_at <= now()`), publica na fila `wager-events`, e marca `published_at` (ou `next_attempt_at` com backoff em caso de falha). Usa `lockMode: PESSIMISTIC_WRITE` no `lockPendingBatch` (um publisher por vez; múltiplos publishers concorrentes na Fase 12).
- **Worker de `PENDING_REFERENCE`**: loop a cada 30s. Busca transações em `PENDING_REFERENCE` com `next_attempt_at` vencido (ou nulo), e reprocessa com `reprocess: true` (resolve a referência de novo, aplica a policy). Se `attempts > 8` ou `age > 15min` → `REJECTED` com `REFERENCE_NOT_FOUND` + evento na outbox.
- **Graceful shutdown** (SIGTERM/SIGINT): para os loops.

### Teste do worker de `PENDING_REFERENCE`

Cenário do desafio (referência entregue fora de ordem):

1. Criar uma wallet (`POST /wallets`).
2. Submeter um `REFUND` referenciando `ext-99` (que não existe) → `202 PENDING_REFERENCE`.
3. Criar a `BET` `ext-99` (mesma wallet, mesmo player, mesmo round, mesmo valor) → `201 PROCESSED`.
4. Aguardar 30s (o worker reprocessa o `REFUND`) → `ext-11` vira `PROCESSED`, saldo volta ao valor anterior.

## Observabilidade

- **Logs JSON estruturados** com `nestjs-pino`: cada request tem `correlationId` (do header `X-Correlation-Id` ou `randomUUID()`), e os campos sensíveis são omitidos (`authorization`, `idempotency-key`, `money`, `balance`, `payload`).
- **`GET /metrics`** (Prometheus, `prom-client`): expõe as métricas do processo da app. As métricas de processamento ficam nos processos do consumer/publisher (o Prometheus scrapeia cada processo).
- **Métricas** (8):
  - `wager_transactions_total{status}` — transações por status (`PROCESSED`/`REJECTED`/`PENDING_REFERENCE`/`FAILED`).
  - `wager_duplicates_total` — duplicatas detectadas (inbox replay).
  - `wager_idempotency_conflicts_total` — conflitos de idempotência.
  - `wager_retries_total{source}` — retries (consumer, publisher).
  - `wager_dlq_messages_total` — mensagens na DLQ.
  - `wager_lock_conflicts_total` — conflitos de lock.
  - `wager_outbox_lag_seconds` — idade do evento mais antigo não publicado.
  - `wager_processing_duration_seconds{operation}` — latência de processamento.
- **Health checks** (`GET /health/live`, `GET /health/ready`) já existem desde a Fase 6.

### `correlationId`

O header `X-Correlation-Id` (se enviado) é usado como `correlationId`; senão, `randomUUID()`. O `correlationId` aparece nos logs, é devolvido no response header, e é propagado para o use case, eventos e logs do consumer.

## Docker

### Imagem da app

`Dockerfile` (bun puro, sem `dist/`): `FROM oven/bun:1.4.4`, `bun install --frozen-lockfile`, `CMD ["bun", "src/main.ts"]`. O `.dockerignore` exclui `node_modules`, `dist`, `test`, `migrations`, `infra`, `.env`.

### Compose

O `docker-compose.yml` sobe:
- `postgres` (5432) e `localstack` (4566).
- `app` (3 instâncias, sem `ports` — acesso via rede interna).
- `consumer` (2 instâncias) e `workers` (1 instância).

```powershell
docker compose up -d --scale app=3 --scale consumer=2 --scale workers=1
docker compose ps
```

### Testar as instâncias

```powershell
docker exec teste-tecnico-jungle-gaming-app-1 bun -e "const r = await fetch('http://localhost:3000/health/live'); console.log(await r.text())"
```

Esperado: `{"status":"ok"}` (as 3 instâncias respondem).

### `assertLedgerConsistent`

O helper `test/helpers/assert-ledger-consistent.ts` soma o ledger (créditos − débitos) e compara com `wallet.balance`. Usado no fim de cada teste de integração/concorrência.

## Teste de carga

Script próprio (`load/load-test.ts`, Bun + `fetch`), sem k6. Mede a latência, throughput, p50/p95/p99, taxa de erro, rejeições de negócio e outbox lag.

### Metodologia

- **Ambiente**: Docker Compose local (Postgres + LocalStack + app **local**, `bun run start`). O Compose com 3 instâncias não expõe porta; o teste de carga usa a app local (`localhost:3000`).
- **Carga**: `CONCURRENCY` workers (default 50) submetendo `BET` de `1.00` BRL para `PLAYER_POOL` wallets (default 100), por `DURATION_SECONDS` (default 30s).
- **Métrica**: latência por request (`performance.now()`), throughput, p50/p95/p99, taxa de erro, rejeições de negócio, outbox lag.

### Como rodar

```powershell
# terminal 1: app local
bun run start

# terminal 2: teste de carga
bun run load
```

### Resultados (exemplo — ambiente local)
Métrica	             Valor
Total de requests  	2.956
Sucesso (2xx)	      2.956 (100%)
Erros (0/5xx)	       0
Rejeições (422)	     0
Replays	             0 (key única por request)
Throughput	        98.53 req/s
p50	                502.42 ms
p95	                777.65 ms
p99	                930.56 ms
Outbox lag	        4.42 s

## Scripts

- `bun run dev` — inicia a aplicação em http://localhost:3000
- `bun run start` — inicia a aplicação (modo produção)
- `bun run typecheck` — verifica erros de tipagem sem executar
- `bun run test` — todos os testes (unitários + integração + concorrência)
- `bun run test:integration` — testes de integração (Postgres real, `wagering_test`)
- `bun run test:concurrency` — testes de concorrência (paralelismo real, 3 instâncias, kill/restart)
- `bun run migration:create` — cria migration
- `bun run migration:up` — aplica migrations
- `bun run migration:down` — reverte migrations
- `bun run consumer` — inicia o consumer SQS (processo separado, sem HTTP)
- `bun run workers` — inicia o outbox publisher + worker de `PENDING_REFERENCE`
- `bun run load` — teste de carga (50 workers, 30s, 100 players; `load/load-test.ts`)

## Stack

### Bun

Runtime, package manager, test runner e bundler de JavaScript/TypeScript.

### NestJS

Framework HTTP da aplicação.

### MikroORM

ORM para PostgreSQL, com suporte a migrations.

### Bibliotecas complementares

- `decimal.js` — aritmética decimal
- `@aws-sdk/client-sqs` — cliente SQS
- `pino` / `nestjs-pino` — logging
- `prom-client` — métricas Prometheus
- `zod` — validação de schemas

## Testes

### Unitários

```powershell
bun test test/unit
```

Esperado: **63 testes** (domínio + use cases), 0 falhas.

### Integração (Postgres real)

Requer o Postgres de pé (`docker compose up -d`) e o banco `wagering_test`:

```powershell
docker compose exec postgres createdb -U wagering wagering_test
bun run test:integration
```

Esperado: **17 testes** (constraints, atomicidade, inbox, outbox, repositório), 0 falhas.

O setup (`test/integration/setup.ts`) roda as migrations no `wagering_test` e aplica o trigger do ledger (idempotente, com `drop trigger if exists`).

### Concorrência (paralelismo real)

Requer o Compose de pé (3 instâncias da app, 2 consumers, 1 workers):

```powershell
docker compose up -d --scale app=3 --scale consumer=2 --scale workers=1
bun run test:concurrency
```

Esperado: **9 testes** (wallet, outbox, pending-reference, 3 instâncias, kill/restart), 0 falhas.

### Todos

```powershell
bun test
```

Esperado: **~89 testes** (63 unitários + 17 integração + 9 concorrência), 0 falhas.

## Estrutura

```text
src/
├── application/
│   ├── ports/
│   └── use-cases/
│       ├── create-wallet/
│       ├── process-wager-transaction/
│       └── reconcile-wallet/
├── consumers/
├── workers/
├── infra/
│   ├── observability/
│   └── persistence/
├── interfaces/
│   └── http/
│       ├── controllers/
│       ├── health/
│       ├── dtos/
│       ├── pipes/
│       ├── filters/
│       ├── middleware/
│       └── http.module.ts
├── app.controller.ts
├── app.module.ts
└── main.ts
test/
├── helpers/
│   ├── assert-ledger-consistent.ts
│   ├── concurrency-harness.ts
│   └── integration-harness.ts
├── unit/
├── integration/
│   ├── setup.ts
│   ├── repositories.test.ts
│   ├── constraints.test.ts
│   ├── atomicity.test.ts
│   ├── inbox.test.ts
│   └── outbox.test.ts
└── concurrency/
    ├── wallet-concurrency.test.ts
    ├── outbox-concurrency.test.ts
    ├── pending-reference.test.ts
    ├── instances.test.ts
    ├── kill-after-commit.test.ts
    └── restart.test.ts
migrations/
├── Migration20261106013011.ts
├── Migration20261106020000_add_invariants.ts
└── sql/
    └── forbid_ledger_mutation.sql
infra/
└── localstack-init.sh
load/
├── load-test.ts
└── README.md
mikro-orm.config.ts
Dockerfile
.dockerignore
docker-compose.yml
package.json
tsconfig.json
README.md
ARCHITECTURE.md
```

## Documentação adicional

- `ARCHITECTURE.md` — decisões arquiteturais, testes de concorrência, containerização, limitações conhecidas.
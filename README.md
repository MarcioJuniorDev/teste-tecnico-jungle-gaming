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
```

> `@types/express@4` (devDependency) é necessário porque o `DomainExceptionFilter` e o `HealthController` tipam a response com `Response` do Express, e o `@nestjs/platform-express` usa Express 4 (o `@types/express@5` é incompatível).

## Infraestrutura (Docker)

Sobe PostgreSQL (porta 5432) e LocalStack (porta 4566) com healthchecks e volumes persistentes:

```powershell
docker compose up -d
docker compose ps
```

O script `infra/localstack-init.sh` cria as filas `wager-transactions.fifo`, `wager-transactions-dlq.fifo` e `wager-events`, com redrive da fila principal para a DLQ após 5 tentativas.

## Banco de Dados

### Migrations
- bun run migration:create   # gera nova migration a partir do diff das entidades
- bun run migration:up       # aplica migrations pendentes
- bun run migration:down     # reverte a última migration

A migration inicial (20261106013011) cria as tabelas; a migration 20261106020000_add_invariants adiciona as constraints (CHECK, FOREIGN KEY, índice único parcial de reversão).

#### Trigger de imutabilidade do ledger
O trigger wallet_ledger_entries_immutable e a função forbid_ledger_mutation() são aplicados fora das migrations, via psql, porque o runner do MikroORM v7 separa statements por ; e quebra blocos PL/pgSQL delimitados por $$. O SQL versionado está em migrations/sql/forbid_ledger_mutation.sql:
```Get-Content .\migrations\sql\forbid_ledger_mutation.sql | docker compose exec -T postgres psql -U wagering -d wagering```

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

O publisher usa `markPublished(id)` e `scheduleRetry(id, attempts, nextAttemptAt)` — `UPDATE` direto por id, sem depender do `save` robusto (que conflitava com o `markPublished` do domínio). O `lockPendingBatch` usa `lockMode: PESSIMISTIC_WRITE` (trava as linhas; um publisher por vez). Múltiplos publishers concorrentes (Fase 10) exigem SQL cru com `FOR UPDATE SKIP LOCKED`.

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

## Workers

Os workers rodam em **processo separado** (`bun run workers`), sem HTTP:

- **Outbox publisher**: loop contínuo (sleep 2s quando não há mensagens). Seleciona até 20 mensagens pendentes (`published_at IS NULL`, `next_attempt_at <= now()`), publica na fila `wager-events`, e marca `published_at` (ou `next_attempt_at` com backoff em caso de falha). Usa `lockMode: PESSIMISTIC_WRITE` no `lockPendingBatch` (um publisher por vez; múltiplos publishers concorrentes na Fase 10).
- **Worker de `PENDING_REFERENCE`**: loop a cada 30s. Busca transações em `PENDING_REFERENCE` com `next_attempt_at` vencido (ou nulo), e reprocessa com `reprocess: true` (resolve a referência de novo, aplica a policy). Se `attempts > 8` ou `age > 15min` → `REJECTED` com `REFERENCE_NOT_FOUND` + evento na outbox.
- **Graceful shutdown** (SIGTERM/SIGINT): para os loops.

### Teste do worker de `PENDING_REFERENCE`

Cenário do desafio (referência entregue fora de ordem):

1. Criar uma wallet (`POST /wallets`).
2. Submeter um `REFUND` referenciando `ext-99` (que não existe) → `202 PENDING_REFERENCE`.
3. Criar a `BET` `ext-99` (mesma wallet, mesmo player, mesmo round, mesmo valor) → `201 PROCESSED`.
4. Aguardar 30s (o worker reprocessa o `REFUND`) → `ext-11` vira `PROCESSED`, saldo volta ao valor anterior.

### Script

- `bun run workers` — inicia o outbox publisher + worker de `PENDING_REFERENCE` (processo separado).

## Scripts

- `bun run dev` — inicia a aplicação em http://localhost:3000
- `bun run start` — inicia a aplicação (modo produção)
- `bun run typecheck` — verifica erros de tipagem sem executar
- `bun run test` — testes unitários
- `bun run test:integration` — testes de integração
- `bun run test:concurrency` — testes de concorrência
- `bun run migration:create` — cria migration
- `bun run migration:up` — aplica migrations
- `bun run migration:down` — reverte migrations
- `bun run consumer` — inicia o consumer SQS (processo separado, sem HTTP).
- `bun run workers` — inicia o outbox publisher + worker de `PENDING_REFERENCE`

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

Testes unitários de domínio (Money, WalletLedgerEntry, Wallet, WagerTransaction, InboxMessage, OutboxMessage, WagerPolicy) em `test/unit/`:

```powershell
bun test
```

- Esperado: 63 testes (62 unitários + 1 integração), 0 falhas.

- O teste de integração (test/integration/repositories.test.ts) requer o Postgres de pé (docker compose up -d).

## Estrutura

```
src/
├── application/
│   ├── ports/
│   │   ├── wallet.repository.ts
│   │   ├── wager-transaction.repository.ts
│   │   ├── inbox.repository.ts
│   │   ├── outbox.repository.ts        # findPendingDue, lockPendingBatch, save, markPublished, scheduleRetry
│   │   ├── ledger.repository.ts
│   │   └── unit-of-work.ts             # TransactionalRepositories + UnitOfWork
│   └── use-cases/
│       ├── create-wallet/
│       ├── process-wager-transaction/  # command com reprocess?
│       └── reconcile-wallet/
├── consumers/                          # consumidor SQS (processo separado)
│   ├── main.ts
│   ├── consumers.module.ts
│   ├── sqs-consumer.service.ts
│   ├── sqs-message.ts
│   ├── error-classifier.ts
│   └── backoff.ts
├── workers/                            # outbox publisher + worker de PENDING_REFERENCE (processo separado)
│   ├── main.ts
│   ├── workers.module.ts
│   ├── outbox-publisher.service.ts
│   └── pending-reference.worker.ts
├── domain/
├── infra/
│   └── persistence/
│       ├── entities/
│       ├── mappers/
│       ├── repositories/
│       └── persistence.module.ts
├── interfaces/
│   └── http/
│       ├── controllers/
│       ├── health/
│       ├── dtos/
│       ├── pipes/
│       ├── filters/
│       └── http.module.ts
├── app.controller.ts
├── app.module.ts
└── main.ts
test/
├── unit/
└── integration/
migrations/
infra/
mikro-orm.config.ts
docker-compose.yml
package.json
tsconfig.json
README.md
ARCHITECTURE.md
```

## Documentação adicional

- `ARCHITECTURE.md` — decisões arquiteturais
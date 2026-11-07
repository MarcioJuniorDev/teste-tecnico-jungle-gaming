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
│   ├── ports/                          # interfaces + Symbol tokens
│   │   ├── wallet.repository.ts
│   │   ├── wager-transaction.repository.ts
│   │   ├── inbox.repository.ts
│   │   ├── outbox.repository.ts
│   │   ├── ledger.repository.ts
│   │   └── unit-of-work.ts
│   └── use-cases/
│       ├── create-wallet/
│       ├── process-wager-transaction/
│       └── reconcile-wallet/
├── domain/                             # domínio puro (sem Nest/ORM)
│   ├── money/
│   ├── ledger/
│   ├── wallet/
│   ├── wagering/
│   │   └── events/
│   ├── messaging/
│   └── shared/
├── infra/
│   └── persistence/
│       ├── entities/
│       ├── mappers/
│       ├── repositories/
│       └── persistence.module.ts
├── interfaces/
│   └── http/
│       ├── controllers/
│       │   ├── wallet.controller.ts
│       │   ├── wager-transaction.controller.ts
│       │   ├── ledger.controller.ts
│       │   ├── reconciliation.controller.ts
│       │   └── health.controller.ts
│       ├── health/
│       │   ├── db.health-indicator.ts
│       │   └── sqs.health-indicator.ts
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
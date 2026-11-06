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
```

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

Esperado: **63 testes** (55 unitários + 8 do use case + 1 integração), 0 falhas.

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
│       └── process-wager-transaction/
│           ├── process-wager-transaction.command.ts
│           ├── process-wager-transaction.result.ts
│           ├── process-wager-transaction.errors.ts
│           ├── process-wager-transaction.use-case.ts
│           └── payload-hash.ts
├── domain/                             # domínio puro (sem Nest/ORM)
│   ├── money/
│   │   └── money.ts
│   ├── ledger/
│   │   ├── ledger-direction.ts
│   │   └── wallet-ledger-entry.ts
│   ├── wallet/
│   │   ├── wallet.ts
│   │   └── wallet-state.ts
│   ├── wagering/
│   │   ├── failure-code.ts
│   │   ├── wager-policy.ts
│   │   ├── wager-transaction.ts
│   │   ├── wager-transaction-kind.ts
│   │   ├── wager-transaction-status.ts
│   │   ├── wager-transaction-state.ts
│   │   ├── event-context.ts
│   │   └── events/
│   │       ├── wallet-balance-changed.ts
│   │       ├── wager-transaction-pending-reference.ts
│   │       ├── wager-transaction-processed.ts
│   │       └── wager-transaction-rejected.ts
│   ├── messaging/
│   │   ├── inbox-message.ts
│   │   ├── inbox-message-state.ts
│   │   ├── outbox-message.ts
│   │   ├── outbox-message-state.ts
│   │   └── integration-event.ts
│   └── shared/
│       ├── domain-error.ts
│       ├── invalid-money-error.ts
│       └── invalid-transaction-state-error.ts
├── infra/
│   └── persistence/
│       ├── entities/                   # entidades MikroORM (separadas do domínio)
│       │   ├── money.embeddable.ts
│       │   ├── wallet.entity.ts
│       │   ├── wallet-ledger-entry.entity.ts
│       │   ├── wager-transaction.entity.ts
│       │   ├── inbox-message.entity.ts
│       │   └── outbox-message.entity.ts
│       ├── mappers/                    # domínio ↔ ORM
│       │   ├── wallet.mapper.ts
│       │   ├── wallet-ledger-entry.mapper.ts
│       │   ├── wager-transaction.mapper.ts
│       │   ├── inbox-message.mapper.ts
│       │   └── outbox-message.mapper.ts
│       ├── repositories/               # implementações MikroORM das portas
│       │   ├── wallet.repository.ts
│       │   ├── wager-transaction.repository.ts
│       │   ├── inbox.repository.ts
│       │   ├── outbox.repository.ts
│       │   ├── ledger.repository.ts
│       │   └── unit-of-work.ts
│       └── persistence.module.ts
├── interfaces/                         # HTTP, SQS consumer, health (a implementar)
│   └── http/
├── app.controller.ts
├── app.module.ts
└── main.ts

test/
├── unit/
│   ├── money.test.ts
│   ├── wallet.test.ts
│   ├── wallet-ledger-entry.test.ts
│   ├── wager-transaction.test.ts
│   ├── wager-policy.test.ts
│   ├── inbox-message.test.ts
│   ├── outbox-message.test.ts
│   └── process-wager-transaction.test.ts
├── integration/
│   └── repositories.test.ts
└── concurrency/                        # (a implementar)

migrations/
├── Migration20261106013011.ts
├── Migration20261106020000_add_invariants.ts
└── sql/
    └── forbid_ledger_mutation.sql

infra/
└── localstack-init.sh                  # cria as filas SQS

mikro-orm.config.ts
docker-compose.yml
package.json
tsconfig.json
README.md
ARCHITECTURE.md
```

## Documentação adicional

- `ARCHITECTURE.md` — decisões arquiteturais
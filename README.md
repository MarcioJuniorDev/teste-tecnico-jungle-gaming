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

Testes unitários de domínio (Money, WalletLedgerEntry, Wallet, WagerTransaction) em `test/unit/`:

```powershell
bun test
```

## Estrutura

```text
src/
├── domain/            # domínio puro (sem Nest/ORM)
│   ├── money/
│   ├── ledger/
│   ├── wallet/
│   └── wagering/
├── infrastructure/    # MikroORM, SQS, outbox (em construção)
├── application/       # use cases, ports (a implementar)
├── interfaces/        # HTTP, SQS consumer, health (a implementar)
├── app.module.ts
└── main.ts
test/unit/             # testes de domínio
migrations/            # migrations (vazia até a Fase 3)
```

## Documentação adicional

- `ARCHITECTURE.md` — decisões arquiteturais
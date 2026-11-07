# ORM
MikroORM. Preferido pelo desafio.
- Unit of Work explícito.
- Identity Map. Um `fork()` por requisição.
- `LockMode` nativo.
- Decorators vêm de `@mikro-orm/decorators/legacy` (v7 removeu do `core`); `legacy` é compatível com `experimentalDecorators`/`emitDecoratorMetadata`, exigidos pelo NestJS.

## Separação domínio ↔ ORM
- Entidades em `src/infra/persistence/entities/`, separadas do domínio puro.
- Mappers explícitos em `src/infra/persistence/mappers/`, usando `rehydrate` (ORM → domínio) e `.toJSON()` (domínio → colunas).
- Domínio não importa MikroORM; o ORM não vaza para `src/domain/`.

## Money
- Duas colunas: `amount NUMERIC(19,2)` e `currency CHAR(3)`.
- Mapeado como `MoneyEmbeddable` (embeddable inline, sem `object: true`), com `fieldName` explícito (`amount`, `currency`) e prefixo por uso (`money_`, `balance_`, `balance_before_`, `balance_after_`).
- Reidratado como `Money`.
- Exato. Sem float.

# Concorrência
Lock pessimista por wallet: `SELECT ... FOR UPDATE`.
- Disputa pelo mesmo saldo é frequente.
- Optimistic geraria retries demais.
- Lock por linha, nunca global.
- Wallets distintas rodam em paralelo.
- `version` é defesa extra: `UPDATE ... WHERE version = ?`.
- Trade-off: hot wallet serializa.

# Idempotência
`UNIQUE (provider_id, idempotency_key)` em `wager_transactions`.
- Header `Idempotency-Key` é a fonte da verdade.
- Sobrevive a restart e a várias instâncias.
- Perdedor da corrida relê o registro.
- Hash igual: replay.
- Hash diferente: conflito.
- Inbox persistente (`PRIMARY KEY (consumer_name, message_id)`) deduplica mensagens SQS.

# Hash
SHA-256 do JSON canônico (chaves ordenadas).
- Campos: `providerId`, `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`, `money`.
- `money` entra como string.
- Header e metadados ficam fora.

# Mapeamento HTTP
| Código | Situação |
|---|---|
| 400 | Payload inválido |
| 404 | Wallet/transação inexistente |
| 409 | Conflito de idempotência ou wallet duplicada |
| 201 | Processado, primeira vez |
| 200 | Replay ou leitura |
| 202 | Pendente (`PENDING_REFERENCE`) |
| 422 | Rejeição de negócio, com `failureCode` |
| 503 | `ready` com dependência fora |

# Taxonomia de failureCode
| Código | Ação |
|---|---|
| `INSUFFICIENT_FUNDS` | Desistir |
| `REVERSAL_WOULD_OVERDRAW` | Desistir |
| `REFERENCE_NOT_FOUND` | Corrigir |
| `REFERENCE_MISMATCH` | Corrigir |
| `REFERENCE_ALREADY_REVERSED` | Desistir |
| `INVALID_REFERENCE_KIND` | Corrigir |
| `AMOUNT_MISMATCH` | Corrigir |
| `CURRENCY_MISMATCH` | Corrigir |
| `WALLET_NOT_FOUND` | Corrigir |
| `INTERNAL_ERROR` | Reenviar |

# PENDING_REFERENCE
Máximo de 8 tentativas. Backoff exponencial: 5s, 10s, 20s... ~10 min. TTL rígido de 15 min.
- Referência atrasada chega em segundos.
- Backoff poupa o banco.
- Sem limite, a fila de pendentes cresce.
- Esgotou: `REJECTED` com `REFERENCE_NOT_FOUND` e evento publicado.

# Autenticação
Não implementada.
- Não pontua.
- `AuthGuard` no-op.
- `ProviderIdentityPort` isola a extensão.
- Desenho futuro: Keycloak via OIDC.

# Domínio
- A reconciliação usa `Money` (não `number`) para somar o ledger; o `difference` é `stored.subtract(calculated)`, e `isZero()` decide `consistent`.

## Money
- Imutável, `Decimal` interno, escala fixa 2.
- `from` rejeita mais de 2 casas (não arredonda).
- `isPositive()` exclui zero (corrige comportamento do `Decimal`).
- Operações entre moedas diferentes lançam `InvalidMoneyError`.
- Serialização sempre em string decimal ("25.00"), nunca `number`.

## Wallet
- Agregado: `debit`/`credit` retornam `{ entry, wallet }` — movimentação e ledger atômicos no domínio.
- A wallet original não é mutada (nova instância, `version` + 1).
- Saldo nunca negativo (checagem no domínio + `CHECK` no banco).
- `rehydrate` não revalida transições.

## WalletLedgerEntry
- Imutável: sem setters, sem transições. `create` valida `balanceBefore ± money === balanceAfter`.
- Imutabilidade reforçada no banco por trigger (`wallet_ledger_entries_immutable`), que bloqueia `UPDATE`/`DELETE`.
- Um lançamento por `(transaction_id, wallet_id)` (`UNIQUE` no schema).

## WagerTransaction
- `OPENING` é interno: `create` o rejeita; `createOpening` é a factory interna.
- `REFUND`/`ROLLBACK` exigem `referenceExternalTransactionId` no `create`.
- Terminais (`PROCESSED`/`REJECTED`/`FAILED`) lançam `InvalidTransactionStateError` em qualquer transição.
- `ledgerDirectionFor` deriva a direção do `kind`; `ROLLBACK` inverte a direção da referência.
- `matchesPayload` compara o `payloadHash` para distinguir replay de conflito.

## WagerPolicy
- Função pura: `evaluate(input): PolicyDecision` (`PROCESS` | `REJECT` + `failureCode` | `PENDING_REFERENCE`).
- Sem ORM, sem Nest, sem repositório. Recebe transação, saldo, referência já resolvida e `existingReversals` (booleans).
- Regras: referência ausente → pendente; mismatch de provider/player/wallet/round → `REFERENCE_MISMATCH`; só moeda → `CURRENCY_MISMATCH`; `REFUND` só de `BET`; `ROLLBACK` de `BET`/`WIN`/`REFUND`; valor diferente → `AMOUNT_MISMATCH`; já revertida → `REFERENCE_ALREADY_REVERSED`; `BET` sem saldo → `INSUFFICIENT_FUNDS`; reversão que negativaria → `REVERSAL_WOULD_OVERDRAW`.
- A resolução da referência no banco fica no use case.

## InboxMessage e OutboxMessage
- `InboxMessage`: `receive`/`rehydrate`, `isProcessed`, `markProcessed` (lança em dupla marcação). Chave lógica `(consumerName, messageId)`.
- `OutboxMessage`: `enqueue(event)` guarda o envelope (`toJSON()`) em `payload`; `scheduleRetry(now)` com backoff exponencial (base 5s, fator 2, teto 5min, jitter ±20%); `markPublished`, `isDue(now)`.
- `Inbox` é idempotência de entrada; `Outbox` é confiabilidade de publicação (at-least-once). A idempotência da saída fica no consumidor, via `eventId`.

## IntegrationEvent
- Envelope abstrato (`eventId`, `aggregateId`, `correlationId`, `causationId?`, `occurredAt`, `version`, `data` congelado).
- `toJSON()` serializa `occurredAt` como ISO-8601; `data` carrega `MoneyProps` (string), nunca `Money`.
- Eventos concretos: `WagerTransactionProcessed`, `WagerTransactionRejected`, `WalletBalanceChanged`, `WagerTransactionPendingReference`.

# Persistência
- Portas em `src/application/ports/` (interface + `Symbol` token), implementações em `src/infra/persistence/repositories/`.
- O domínio não conhece MikroORM; os repositórios usam mappers explícitos (`rehydrate` / `.toJSON()`).
- `UnitOfWork.run(fn)` sobre `em.transactional(fn)`: o `fn` recebe `TransactionalRepositories` (os 5 repositórios **com o `tx` transacional**) e o `EntityManager`. Os use cases de escrita (`ProcessWagerTransaction`, `CreateWallet`) usam os repositórios transacionais, **não** os injetados no construtor. Isso garante que `inbox`, `wallet`, `ledger`, `transaction` e `outbox` participem da **mesma transação**.
- O `MikroOrmUnitOfWork.run` cria os repositórios **com o `tx`** dentro de `em.transactional` e os passa para o `fn`. O `ReconcileWalletUseCase` (leitura) continua com os repositórios injetados.
- `WalletRepository.findByIdForUpdate` usa `LockMode.PESSIMISTIC_WRITE` (lock por linha).
- Fork por request automático (`@mikro-orm/nestjs`); `fork()` explícito só em workers de background.
- `entities` do runtime aponta para `src/` (Bun transpila TS direto); `dist/` fica para containerização.
- Tokens `Symbol` porque interfaces somem no runtime; o NestJS precisa de um valor de injeção.
- `save` dos repositórios faz `findOne` + `assign`/`persist`: insert se não existe, update se existe. Resolve o `persist` de entidade nova em update (que violava a PK). Custo: um `SELECT` extra por save; otimização na Fase 12.
- `LedgerRepository` tem `findPage` (cursor por `(createdAt, id)`) e `sumByWallet` (soma de créditos − débitos, usada na reconciliação). O `findPage` usa `QueryBuilder` com `ORDER BY createdAt, id` e `LIMIT limit + 1` para detectar se há próxima página.
- O cursor do ledger é opaco (base64 de JSON `{ createdAt, id }`); o cliente não interpreta — só devolve no `cursor` da próxima chamada.
- `OutboxRepository` tem `findPendingDue`, `lockPendingBatch` (com `PESSIMISTIC_WRITE`), `save`, `markPublished(id)` e `scheduleRetry(id, attempts, nextAttemptAt)`. O `markPublished`/`scheduleRetry` são `UPDATE` direto por id — não usam o `save` robusto (que conflita com o `markPublished` do domínio).

# API HTTP
- Controllers finos em `src/interfaces/http/controllers/`: validam com zod, chamam o use case (escrita) ou a porta (leitura), mapeiam o resultado para HTTP.
- `ZodValidationPipe` valida o body; falha → `400 VALIDATION_FAILED` com a lista de issues.
- `DomainExceptionFilter` (global) mapeia:
  - `IdempotencyConflictError` → `409 IDEMPOTENCY_CONFLICT`.
  - `WalletAlreadyExistsError` → `409 WALLET_ALREADY_EXISTS`.
  - `WalletNotFoundError` → `404 WALLET_NOT_FOUND`.
  - `InvalidMoneyError` → `400 INVALID_MONEY`.
  - `InvalidTransactionStateError` → `409 INVALID_TRANSACTION_STATE`.
  - `DomainError` → `400 DOMAIN_ERROR`.
- Rejeição de negócio (`REJECTED`) não é exceção: o controller lê `result.status` e devolve `422` com `failureCode`.
- `PENDING_REFERENCE` → `202`. Processado primeira vez → `201`. Replay → `200`.
- Header `Idempotency-Key` obrigatório; ausente → `422 MISSING_IDEMPOTENCY_KEY`.
- `POST /wallets` usa `CreateWalletUseCase`: wallet nasce com zero, `OPENING` credita o saldo inicial, ledger `CREDIT` e outbox na mesma transação; duplicado → `409`.
- Endpoints de leitura usam as portas direto no controller (sem use case): wallet, transações, ledger.
- **Ledger paginado** (`GET /wallets/:id/ledger`): cursor opaco = base64 de JSON `{ createdAt, id }`; query `(createdAt, id) > (cursorCreatedAt, cursorId)` com `ORDER BY createdAt, id`; `limit` default 50, max 100; resposta com `items` e `nextCursor`.
- **Reconciliação** (`POST /wallets/:id/reconciliation`): `ReconcileWalletUseCase` soma o ledger (`sumByWallet`) e compara com `wallet.balance`; divergência → `consistent: false` + log (sem corrigir).
- **Health** (`GET /health/live`, `GET /health/ready`): `live` sempre `200`; `ready` checa PG (`select 1`) e SQS (`GetQueueAttributes` com timeout 2s), `200` se ambos ok, `503` se algum falha.
- Auth não implementada (decisão da Fase 0); `AuthGuard` no-op + `ProviderIdentityPort` a implementar.
- `GET /metrics` — expõe as métricas Prometheus (texto). Sem autenticação.
- `X-Correlation-Id` (header, opcional): o middleware lê ou gera `randomUUID()`, guarda no `req` e devolve no response. O `correlationId` aparece nos logs e é propagado para o use case.

# Health
- `GET /health/live` — processo vivo; sempre `200 { status: 'ok' }`. Não checa dependências.
- `GET /health/ready` — `200` se PG e SQS respondem; `503` se algum falha.
- `DbHealthIndicator` — `em.execute('select 1')`.
- `SqsHealthIndicator` — `GetQueueAttributes` na fila `wager-transactions.fifo`, timeout 2s (Promise.race). Lê env: `AWS_ENDPOINT_URL`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SQS_QUEUE_URL`; defaults do LocalStack.
- Os health checks não exigem autenticação.

# Consumidor SQS
- Processo separado (`src/consumers/main.ts`), sem HTTP. Sobe o `ConsumersModule` (importa `PersistenceModule`) e o `SqsConsumerService`.
- **Long polling**: `waitTimeSeconds: 20`, `maxNumberOfMessages: 10`, `visibilityTimeout: 30`. Processa em lotes de até 5 em paralelo.
- **Reuso do `ProcessWagerTransactionUseCase`**: o consumer passa `inbox: { consumerName: 'wager-consumer', messageId }`. O use case deduplica por inbox, processa e enfileira eventos na outbox.
- **Ack só após o commit**: o consumer só chama `DeleteMessage` depois que o use case retorna (a transação commitou).
- **Classificação de erros** (`classifyError`):
  - **Transitório** (`ECONNREFUSED`, `40001` serialization_failure, `40P01` deadlock_detected, timeout, abort) → **não ack** + `ChangeMessageVisibility` com backoff exponencial (30s, 60s, 120s... até 300s).
  - **Permanente** (mensagem malformada, `OPENING`) → **não ack**; a visibilidade expira e o SQS move para a DLQ após `maxReceiveCount: 5`.
  - Negócio (`REJECTED`/`PENDING_REFERENCE`) → **ack** (o use case retornou resultado, não lançou).
- **Graceful shutdown** (`onApplicationShutdown`/SIGTERM/SIGINT): para o loop, aguarda até 10s as mensagens em andamento, devolve visibilidade das restantes.
- **`MessageSystemAttributeNames: ['ApproximateReceiveCount']`** no `ReceiveMessage` (atributo do sistema, não da fila); usado para o backoff.
- O corpo da mensagem é JSON com `{ messageId, type, occurredAt, data }`; `type` deve ser `WagerTransactionRequested`; `OPENING` é rejeitado (não pode vir da fila).
- **Envio de teste** via `file:///tmp/msg.json` (o PowerShell remove aspas do `--message-body` inline; o `awslocal` lê o arquivo e preserva o JSON).
- Métricas instrumentadas no consumer: `transactionsTotal` (por status), `duplicatesTotal` (inbox replay), `retriesTotal` (transitório), `idempotencyConflictsTotal`, `processingDuration` (latência).
- O `execute` captura `UniqueConstraintViolationException` e retenta em uma nova transação (`handleRaceLoser`). O Postgres aborta a transação no erro (`25P02`); a recuperação **não pode** ser dentro da mesma transação.

# Outbox publisher e worker de PENDING_REFERENCE
Dois workers em processo separado (`src/workers/main.ts`), sem HTTP:
- Métricas instrumentadas no publisher: `outboxLagSeconds` (idade do evento mais antigo não publicado), `retriesTotal` (falha na publicação).

## Outbox publisher
- Loop contínuo: a cada iteração, `lockPendingBatch(20)` (até 20 mensagens pendentes) e publica na fila `wager-events`.
- `lockPendingBatch` usa `find` com `lockMode: LockMode.PESSIMISTIC_WRITE` (trava as linhas; **sem** `SKIP LOCKED` — um publisher por vez). Para múltiplos publishers concorrentes, trocar por SQL cru com `FOR UPDATE SKIP LOCKED` (limitação conhecida).
- Publicação: `SendMessageCommand` na `wager-events` (standard; **sem** `MessageGroupId`/`MessageDeduplicationId`, que só existem em fila FIFO). O `eventId` no envelope é a chave de dedup do consumidor.
- Sucesso: `markPublished(id)` (`UPDATE outbox_messages SET published_at = ... WHERE id = ...`).
- Falha: `scheduleRetry(id, attempts, nextAttemptAt)` (`UPDATE` com backoff exponencial: 5s, 10s, 20s... até 5min).
- Loop com `sleep(2s)` quando o lote está vazio.
- **Não usa o `save` robusto** (que faz `findOne` + `assign`/`persist`): `markPublished`/`scheduleRetry` são `UPDATE` direto por id, o que evita o conflito com o `markPublished` do domínio (`OutboxMessage.markPublished` lança se já publicado).

## Worker de PENDING_REFERENCE
- Loop a cada 30s: busca transações em `PENDING_REFERENCE` com `next_attempt_at` nulo ou vencido (limite 20).
- Para cada uma:
  - Se `attempts > 8` ou `age > 15min` → `REJECTED` com `REFERENCE_NOT_FOUND` + evento `WagerTransactionRejected` na outbox.
  - Senão → chama o `ProcessWagerTransactionUseCase` com `reprocess: true`.
- **`reprocess: true`**: o use case **não retorna replay** para uma transação `PENDING_REFERENCE`; ele resolve a referência de novo (via `findByProviderAndExternalId`), aplica a `WagerPolicy`, e decide `PROCESSED`/`REJECTED`/`PENDING_REFERENCE`.
- O `attempts`/`nextAttemptAt` **são incrementados** via `incrementAttempts(id, nextAttemptAt)` antes do reprocess (corrigido na Fase 10a).
- Graceful shutdown (SIGTERM/SIGINT): para os loops.

# Observabilidade
- **Logs JSON** (`nestjs-pino`): substitui o `Logger` padrão do NestJS. O `LoggerModule.forRoot` configura:
  - `genReqId`: lê `X-Correlation-Id` ou `randomUUID()`.
  - `customProps`: adiciona `correlationId` aos logs.
  - `redact`: remove `authorization`, `idempotency-key`, `money`, `balance`, `payload` dos logs (sem dados sensíveis/payloads financeiros completos).
  - `transport`: `pino-pretty` em dev (logs formatados); JSON puro em produção.
- **`CorrelationIdMiddleware`**: lê `X-Correlation-Id` (ou `randomUUID()`), guarda no `req` e devolve no response header. Aplicado em todas as rotas (`forRoutes('*')`).
- **`correlationId`** propagado do HTTP/SQS → use case → eventos → logs. No HTTP, o `WagerTransactionController` lê do `req`; no SQS, o `correlationId` é o `messageId`.
- **Métricas** (`prom-client`, `MetricsService`):
  - 8 métricas (transações por status, duplicatas, conflitos de idempotência, retries, DLQ, lock conflicts, outbox lag, latência).
  - `collectDefaultMetrics` (CPU, memória, event loop, heap).
  - `GET /metrics` (`MetricsController`) expõe o registro. Sem autenticação (convenção Prometheus).
  - **`ObservabilityModule`** é `@Global` — o `MetricsService` fica disponível em todos os módulos (HTTP, consumer, workers) sem importar o módulo em cada um.
- **Processos separados**: as métricas de processamento (consumer/publisher) ficam nos **processos deles** (o `MetricsService` é instanciado por processo). O `/metrics` da app mostra as métricas zeradas + as padrão. O Prometheus (Fase 12) scrapeia cada processo.
- **Health checks** (`/health/live`, `/health/ready`) já existiam; o `ready` pinga PG e SQS.

# Testes

## Unitários
Domínio + use cases (mocks das portas). **63 testes**. Cobrem Money, Wallet, LedgerEntry, WagerTransaction, WagerPolicy, Inbox, Outbox, ProcessWagerTransaction.

## Integração (Postgres real)
`test/integration/setup.ts`:
- Banco `wagering_test` (separado do dev; `docker compose exec postgres createdb -U wagering wagering_test`).
- Migrations via `orm.migrator.up()`.
- Trigger do ledger via `psql` (idempotente, com `drop trigger if exists`).
- `teardownIntegrationDb` **não fecha** o `orm` global (evita `driver has already been destroyed` entre arquivos de teste).

Testes (**17**):
- **constraints**: 11 testes (cada constraint violada por SQL direto: saldo negativo, moeda, `UNIQUE` de wallet, idempotência, kind, `money_amount`, dupla reversão, `UNIQUE` do ledger, aritmética, trigger de UPDATE, trigger de DELETE).
- **atomicity**: rollback (falha no meio não persiste wallet/outbox); ledger consistente.
- **inbox**: deduplicação (mesma mensagem duas vezes → 1 inbox).
- **outbox**: publishers concorrentes com `PESSIMISTIC_WRITE`, `markPublished` por id.
- **repositories**: `WalletRepository.save`.

## Concorrência (paralelismo real)
`test/helpers/concurrency-harness.ts` sobe o `AppModule` (sem HTTP) com o `ProcessWagerTransactionUseCase` e o `CreateWalletUseCase` reais.

Testes (**9**):
- **wallet-concurrency** (`Promise.all` + use case real via `UnitOfWork`):
  - Saldo 100, duas apostas de 80 simultâneas → 1 `PROCESSED`, 1 `REJECTED` (`INSUFFICIENT_FUNDS`), saldo 20, 1 débito.
  - Mesma aposta × 50 em paralelo → 1 débito, 49 replays (idempotência).
- **outbox-concurrency**: 2 publishers com `PESSIMISTIC_WRITE` (serializa; sem `SKIP LOCKED`); `markPublished` idempotente.
- **pending-reference**: REFUND antes da BET → `PENDING_REFERENCE` → `PROCESSED` (reprocess).
- **instances**: 3 instâncias da app via Compose (`--scale app=3`), health check; invariante final (`wallet.balance == soma do ledger`).
- **kill-after-commit**: worker morto após commit, antes do ack → redelivery não duplica (simulado via reprocess).
- **restart**: reinício do consumer/workers (Compose) mantém a consistência.

**Invariante final:** `assertLedgerConsistent(walletId)` (soma do ledger == `wallet.balance`).

**Correção estrutural (Fase 10c):** o `ProcessWagerTransactionUseCase.execute` captura `UniqueConstraintViolationException` e **retenta em uma nova transação** (`handleRaceLoser`). O Postgres aborta a transação no `UniqueConstraintViolationException` (`25P02`), então a recuperação **não pode** ser dentro da mesma transação. O `persistTransactionWithRaceHandling` é só `save`; a recuperação é no `execute`.

# Containerização
- `Dockerfile` (bun puro, sem `dist/`): `FROM oven/bun:1.4.4`, `bun install --frozen-lockfile`, `CMD ["bun", "src/main.ts"]`. O `entities` do MikroORM aponta para `src/` (Bun transpila TS).
- `.dockerignore`: exclui `node_modules`, `dist`, `test`, `migrations`, `infra`, `.env`.
- `docker-compose.yml`: `app` (sem `ports`; acesso via rede interna), `consumer` (`bun src/consumers/main.ts`), `workers` (`bun src/workers/main.ts`).
- `--scale app=3 --scale consumer=2 --scale workers=1` sobe as instâncias. Health check via `docker exec <container> bun -e "fetch(...)"` (a imagem não tem `wget`/`curl`).
- O `app` **não** expõe porta (o `--scale` não funciona com portas mapeadas); o acesso externo fica para o nginx (Fase 12).

# Schema (banco)
Garantias aplicadas no schema, não só em código:
- `wallets`: `UNIQUE (player_id, currency)`, `CHECK (balance_amount >= 0)`, `CHECK (currency = balance_currency)`, `version`.
- `wager_transactions`: `UNIQUE (provider_id, idempotency_key)`, `UNIQUE (provider_id, external_transaction_id)`, `CHECK` de `kind`/`status`, `CHECK (money_amount >= 0)`, FK `wallet_id`, índice único parcial `(reference_transaction_id, kind) WHERE status = 'PROCESSED'` (impede dupla reversão).
- `wallet_ledger_entries`: `UNIQUE (transaction_id, wallet_id)`, `CHECK` de `direction`, `CHECK (money_amount >= 0)`, `CHECK` de moedas consistentes, `CHECK` de aritmética (`balance_after = balance_before ± money`), FK `wallet_id`, trigger de imutabilidade.
- `inbox_messages`: `PRIMARY KEY (consumer_name, message_id)`.
- `outbox_messages`: índice parcial `WHERE published_at IS NULL`.

# Migrations
- `Migration20261106013011`: schema inicial (tabelas, `UNIQUE`, índice parcial da outbox).
- `Migration20261106020000_add_invariants`: `CHECK`, FKs, índice único parcial de reversão.
- O trigger `wallet_ledger_entries_immutable` e a função `forbid_ledger_mutation()` são criados **fora** das migrations (via `psql`), porque o runner do MikroORM v7 separa statements por `;` e quebra blocos PL/pgSQL delimitados por `$$`.
- O SQL versionado está em `migrations/sql/forbid_ledger_mutation.sql` e deve ser aplicado após `migration:up` (comando no README).
- O SQL é **idempotente** (`drop trigger if exists` + `create or replace function` + `create trigger`), para o setup de integração rodar várias vezes sem falhar.
- Limitação conhecida; candidata a correção na Fase 12 com runner customizado ou `node-pg-migrate`.

# Caso de uso central (ProcessWagerTransaction)
Uma transação SQL por operação, na ordem:
1. Inbox (SQS) — `receive` + `markProcessed`; redelivery processada devolve replay.
2. Idempotência — `findByIdempotencyKey`; hash igual → replay, hash diferente → conflito (`409`).
3. `PENDING` — persiste antes do lock; `UniqueConstraintViolationException` na corrida relê e classifica.
4. Lock — `findByIdForUpdate` (pessimista).
5. `WagerPolicy.evaluate` → `PROCESS` | `REJECT` | `PENDING_REFERENCE`.
6. Aplicação — ledger + wallet + transação; `LOSS` não move saldo.
7. Outbox — eventos enfileirados na mesma transação (`WagerTransactionProcessed`, `WagerTransactionRejected`, `WalletBalanceChanged`, `WagerTransactionPendingReference`).
8. Commit.

- Cada evento da outbox tem `eventId` único (`randomUUID()` por evento); `correlationId`, `causationId` e `occurredAt` são compartilhados. Sem isso, dois eventos no mesmo `ctx` violam a PK da outbox.
- O use case recebe `TransactionalRepositories` do `uow.run` (não os repositórios injetados). Todos os `save`/`find` usam o `tx` transacional — `inbox`, `wallet`, `ledger`, `transaction` e `outbox` commitam juntos ou sofrem rollback juntos.
- `reprocess: true` (no command): quando a transação está em `PENDING_REFERENCE`, o use case **não** retorna replay — ele resolve a referência de novo, aplica a `WagerPolicy`, e decide `PROCESSED`/`REJECTED`/`PENDING_REFERENCE`. Usado pelo worker de `PENDING_REFERENCE`.
- O `execute` captura `UniqueConstraintViolationException` e retenta em uma nova transação (`handleRaceLoser`). O `persistTransactionWithRaceHandling` é só `save`; a recuperação é no `execute`.

Regra: rejeição de negócio **não** derruba a transação (auditável); só erro de infraestrutura faz rollback.

`payloadHash` = SHA-256 do JSON canônico (chaves ordenadas) de `{ providerId, externalTransactionId, playerId, walletId, roundId, gameId, kind, money }`; header/metadados fora.

# Limitações atuais (pós-Fase 10)
- **`SKIP LOCKED` com múltiplos publishers**: o `lockPendingBatch` usa `PESSIMISTIC_WRITE` **sem** `SKIP LOCKED` (um publisher por vez; o segundo espera o primeiro commitar). Para múltiplos publishers concorrentes, trocar por SQL cru com `FOR UPDATE SKIP LOCKED`.
- **Métricas por processo**: as métricas de processamento (consumer/publisher) ficam nos processos deles; o `/metrics` da app mostra as zeradas + padrão. O Prometheus (Fase 12) scrapeia cada processo.
- **Kill simulado**: o `kill-after-commit` **simula** o kill (via reprocess); não mata o processo. O `restart` **reinicia** os containers (Compose).
- **`dlq_messages_total` e `lock_conflicts_total`**: as métricas existem, mas não são incrementadas (a DLQ e os conflitos de lock não são observados; Fase 12).
- **`save` com `SELECT` extra**: os repositórios fazem `findOne` + `assign`/`persist` (um `SELECT` por save). Otimização na Fase 12.
- **`findPage` do ledger**: carrega até `limit + 1` linhas e mapeia uma a uma. Otimização na Fase 12.
- **Trigger do ledger fora das migrations**: o runner do MikroORM v7 quebra blocos `$$`; o trigger é aplicado via `psql` (SQL versionado em `migrations/sql/forbid_ledger_mutation.sql`). Correção candidata: `node-pg-migrate` ou runner customizado.
- **Auth não implementada**: `AuthGuard` no-op + `ProviderIdentityPort` (decisão registrada na Fase 0).
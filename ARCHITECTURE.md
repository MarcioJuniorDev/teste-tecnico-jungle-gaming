# ORM
MikroORM. Preferido pelo desafio.
- Unit of Work explícito.
- Identity Map. Um `fork()` por requisição.
- `LockMode` nativo.
- Decorators vêm de `@mikro-orm/decorators/legacy` (v7 removeu do `core`); `legacy` é compatível com `experimentalDecorators`/`emitDecoratorMetadata`, exigidos pelo NestJS.

## Separação domínio ↔ ORM
- Entidades em `src/infra/persistence/entities/`, separadas do domínio puro.
- Mappers explícitos em `src/infra/persistence/mappers/`, usando `rehydrate` (domínio → ORM) e `.toJSON()` (Money → colunas).
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
| 409 | Conflito de idempotência |
| 201 | Processado, primeira vez |
| 200 | Replay |
| 202 | Pendente (`PENDING_REFERENCE`) |
| 422 | Rejeição de negócio, com `failureCode` |
| 503 | Falha transitória, com `Retry-After` |

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
- A resolução da referência no banco fica no use case (Fase 5).

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
- `UnitOfWork.run(fn)` sobre `em.transactional(fn)`: o use case recebe um `EntityManager` transacional.
- `WalletRepository.findByIdForUpdate` usa `LockMode.PESSIMISTIC_WRITE` (lock por linha).
- Fork por request automático (`@mikro-orm/nestjs`); `fork()` explícito só em workers de background (Fase 8).
- `entities` do runtime aponta para `src/` (Bun transpila TS direto); `dist/` fica para containerização (Fase 10).
- Tokens `Symbol` porque interfaces somem no runtime; o NestJS precisa de um valor de injeção.
- `save` dos repositórios faz `findOne` + `assign`/`persist`: insert se não existe, update se existe. Resolve o `persist` de entidade nova em update (que violava a PK). Custo: um `SELECT` extra por save; otimização na Fase 10.

# API HTTP
- Controllers em `src/interfaces/http/controllers/`, finos: validam com zod, chamam o use case, mapeiam o resultado para HTTP.
- `ZodValidationPipe` valida o body contra o schema; falha → `400` com `VALIDATION_FAILED` e a lista de issues.
- `DomainExceptionFilter` (global) mapeia:
  - `IdempotencyConflictError` → `409` `IDEMPOTENCY_CONFLICT`.
  - `WalletAlreadyExistsError` → `409` `WALLET_ALREADY_EXISTS`.
  - `InvalidMoneyError` → `400` `INVALID_MONEY`.
  - `InvalidTransactionStateError` → `409` `INVALID_TRANSACTION_STATE`.
  - `DomainError` → `400` `DOMAIN_ERROR`.
- Rejeição de negócio (`REJECTED`) **não** é exceção: o controller lê `result.status` e devolve `422` com `failureCode`.
- `PENDING_REFERENCE` → `202`. Processado primeira vez → `201`. Replay → `200`.
- Header `Idempotency-Key` obrigatório; ausente → `422` `MISSING_IDEMPOTENCY_KEY`.
- `POST /wallets` usa `CreateWalletUseCase`: wallet nasce com zero, `OPENING` credita o saldo inicial, ledger `CREDIT` e outbox na mesma transação; duplicado → `409`.
- Endpoints de leitura (Fase 6b) usam as portas direto no controller, sem use case (leitura sem regra de negócio).
- Auth não implementada (decisão da Fase 0); `AuthGuard` no-op + `ProviderIdentityPort` a implementar.

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
- O trigger `wallet_ledger_entries_immutable` e a função `forbid_ledger_mutation()` são criados **fora** das migrations (via `psql`), porque o runner do MikroORM v7 separa statements por `;` e quebra blocos PL/pgSQL delimitados por `$$`. O SQL versionado está em `migrations/sql/forbid_ledger_mutation.sql` e deve ser aplicado após `migration:up`.
- Limitação conhecida; candidata a correção na Fase 4/5 com runner customizado ou `node-pg-migrate`.
- O SQL versionado está em `migrations/sql/forbid_ledger_mutation.sql` e deve ser aplicado após `migration:up` (comando no README).

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

Regra: rejeição de negócio **não** derruba a transação (auditável); só erro de infraestrutura faz rollback.

`payloadHash` = SHA-256 do JSON canônico (chaves ordenadas) de `{ providerId, externalTransactionId, playerId, walletId, roundId, gameId, kind, money }`; header/metadados fora.

# Limitações atuais (pós-Fase 6a)
- Endpoints de leitura (wallet, ledger, transações, reconciliação) e health checks: Fase 6b.
- Sem consumer SQS, outbox publisher, worker de `PENDING_REFERENCE`, observabilidade: Fases 7–9.
- Sem testes de concorrência reais (corrida de `UNIQUE`, lock, 3 instâncias): Fase 10.
- O teste de integração de repositórios roda contra o banco de dev; setup dedicado (banco limpo + migrations) na Fase 10.
- `save` dos repositórios faz `findOne` + `assign`/`persist` (um `SELECT` extra por save). Otimização na Fase 10.
- Sem `Dockerfile` da app.
- Auth não implementada (decisão registrada acima).
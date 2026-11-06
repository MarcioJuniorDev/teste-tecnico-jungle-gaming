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

# Limitações atuais (pós-Fase 3)
- Sem camada de repositórios (portas + implementações) — Fase 4.
- Sem use case `ProcessWagerTransaction` — Fase 5.
- Sem endpoints HTTP, consumer SQS, outbox publisher, observabilidade — Fases 6–9.
- Sem testes de integração/concorrência — Fase 10.
- `entities` do runtime aponta para `./dist/**` (que não existe); só a CLI usa `entitiesTs`. Ajuste na Fase 4/5 (gerar `dist/` ou apontar o runtime para `src/`).
- Sem `Dockerfile` da app; o Compose sobe só PG e LocalStack.
- Auth não implementada (decisão registrada acima).
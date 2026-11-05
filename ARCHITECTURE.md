# ORM
MikroORM. Preferido pelo desafio.
- Unit of Work explícito.
- Identity Map. Um `fork()` por requisição.
- `LockMode` nativo.

## Money
- Duas colunas: `amount NUMERIC(19,2)` e `currency CHAR(3)`.
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
- Saldo nunca negativo (checagem no domínio + `CHECK` no banco, na Fase 3).
- `rehydrate` não revalida transições.

## WagerTransaction
- `OPENING` é interno: `create` o rejeita; `createOpening` é a factory interna.
- `REFUND`/`ROLLBACK` exigem `referenceExternalTransactionId` no `create`.
- Terminais (`PROCESSED`/`REJECTED`/`FAILED`) lançam `InvalidTransactionStateError` em qualquer transição.
- `ledgerDirectionFor` deriva a direção do `kind`; `ROLLBACK` inverte a direção da referência.
- `matchesPayload` compara o `payloadHash` para distinguir replay de conflito.

# Limitações atuais (Fase 2)
- `Wallet`, `WalletLedgerEntry` e `WagerTransaction` são domínio puro — ainda não mapeados no MikroORM.
- Sem `InboxMessage`, `OutboxMessage`, eventos de integração, `WagerPolicy`.
- Sem endpoints HTTP, consumer SQS, outbox publisher, observabilidade.
- Sem `Dockerfile` da app; o Compose sobe só PG e LocalStack.
- Auth não implementada (decisão registrada acima).
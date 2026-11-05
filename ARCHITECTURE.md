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
-- Aplicado fora das migrations porque o runner do MikroORM v7
-- separa statements por ';' e quebra blocos PL/pgSQL delimitados por $$.
-- Rodar apos 'bun run migration:up':
--   Get-Content .\migrations\sql\forbid_ledger_mutation.sql | docker compose exec -T postgres psql -U wagering -d wagering

create or replace function forbid_ledger_mutation() returns trigger as $$
begin
  raise exception 'wallet_ledger_entries is immutable: % not allowed', tg_op;
end;
$$ language plpgsql;

create trigger wallet_ledger_entries_immutable
  before update or delete on wallet_ledger_entries
  for each row execute function forbid_ledger_mutation();

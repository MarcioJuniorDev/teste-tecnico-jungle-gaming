import { Migration } from '@mikro-orm/migrations';

export class Migration20261106020000 extends Migration {
  override name = 'Migration20261106020000_add_invariants';

  override up(): void | Promise<void> {
    // --- wallets ---
    this.addSql(
      `alter table "wallets" add constraint "wallets_balance_non_negative" check ("balance_amount" >= 0);`,
    );
    this.addSql(
      `alter table "wallets" add constraint "wallets_currency_matches_balance" check ("currency" = "balance_currency");`,
    );

    // --- wager_transactions ---
    this.addSql(
      `alter table "wager_transactions" add constraint "wt_kind_valid" check ("kind" in ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK'));`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wt_status_valid" check ("status" in ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED'));`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wt_money_non_negative" check ("money_amount" >= 0);`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wt_wallet_fk" foreign key ("wallet_id") references "wallets" ("id");`,
    );
    this.addSql(
      `create unique index "wt_reference_reversed_once" on "wager_transactions" ("reference_transaction_id", "kind") where "status" = 'PROCESSED' and "reference_transaction_id" is not null;`,
    );

    // --- wallet_ledger_entries ---
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wle_direction_valid" check ("direction" in ('DEBIT','CREDIT'));`,
    );
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wle_money_non_negative" check ("money_amount" >= 0);`,
    );
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wle_currencies_match" check ("money_currency" = "balance_before_currency" and "balance_before_currency" = "balance_after_currency");`,
    );
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wle_arithmetic" check (case when "direction" = 'CREDIT' then "balance_after_amount" = "balance_before_amount" + "money_amount" else "balance_after_amount" = "balance_before_amount" - "money_amount" end);`,
    );
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wle_wallet_fk" foreign key ("wallet_id") references "wallets" ("id");`,
    );

    // Nota: a função forbid_ledger_mutation() e o trigger wallet_ledger_entries_immutable
    // são criados fora desta migration (ver ARCHITECTURE.md, seção "Migrations"),
    // porque o runner do MikroORM v7 separa statements por ';' e quebra blocos PL/pgSQL
    // delimitados por $$. O SQL está em migrations/sql/forbid_ledger_mutation.sql.
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "wt_reference_reversed_once";`);

    this.addSql(`alter table "wallet_ledger_entries" drop constraint if exists "wle_wallet_fk";`);
    this.addSql(`alter table "wallet_ledger_entries" drop constraint if exists "wle_arithmetic";`);
    this.addSql(`alter table "wallet_ledger_entries" drop constraint if exists "wle_currencies_match";`);
    this.addSql(`alter table "wallet_ledger_entries" drop constraint if exists "wle_money_non_negative";`);
    this.addSql(`alter table "wallet_ledger_entries" drop constraint if exists "wle_direction_valid";`);

    this.addSql(`alter table "wager_transactions" drop constraint if exists "wt_wallet_fk";`);
    this.addSql(`alter table "wager_transactions" drop constraint if exists "wt_money_non_negative";`);
    this.addSql(`alter table "wager_transactions" drop constraint if exists "wt_status_valid";`);
    this.addSql(`alter table "wager_transactions" drop constraint if exists "wt_kind_valid";`);

    this.addSql(`alter table "wallets" drop constraint if exists "wallets_currency_matches_balance";`);
    this.addSql(`alter table "wallets" drop constraint if exists "wallets_balance_non_negative";`);
  }
}
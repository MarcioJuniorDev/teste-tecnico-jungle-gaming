import { Migration } from '@mikro-orm/migrations';

export class Migration20261106013011 extends Migration {
  override name = 'Migration20261106013011';

  override up(): void | Promise<void> {
    this.addSql(`create table "inbox_messages" ("consumer_name" varchar(128) not null, "message_id" varchar(128) not null, "payload_hash" varchar(64) not null, "received_at" timestamptz not null, "processed_at" timestamptz null, primary key ("consumer_name", "message_id"));`);

    this.addSql(`create table "outbox_messages" ("id" uuid not null, "aggregate_id" uuid not null, "event_type" varchar(64) not null, "payload" jsonb not null, "occurred_at" timestamptz not null, "attempts" int not null default 0, "next_attempt_at" timestamptz null, "published_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "idx_outbox_pending" on "outbox_messages" ("next_attempt_at") where published_at IS NULL;`);

    this.addSql(`create table "wager_transactions" ("id" uuid not null, "provider_id" varchar(64) not null, "external_transaction_id" varchar(128) not null, "idempotency_key" varchar(200) not null, "payload_hash" varchar(64) not null, "wallet_id" uuid not null, "player_id" uuid not null, "round_id" varchar(128) not null, "game_id" varchar(128) not null, "kind" varchar(16) not null, "money_amount" numeric(19,2) not null, "money_currency" char(3) not null, "reference_external_transaction_id" varchar(128) null, "reference_transaction_id" uuid null, "status" varchar(20) not null, "failure_code" varchar(32) null, "created_at" timestamptz not null, "processed_at" timestamptz null, "next_attempt_at" timestamptz null, "attempts" int not null default 0, primary key ("id"));`);
    this.addSql(`create index "wager_transactions_status_next_attempt_at_index" on "wager_transactions" ("status", "next_attempt_at");`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_provider_id_external_transaction_id_unique" unique ("provider_id", "external_transaction_id");`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_provider_id_idempotency_key_unique" unique ("provider_id", "idempotency_key");`);

    this.addSql(`create table "wallets" ("id" uuid not null, "player_id" uuid not null, "currency" char(3) not null, "balance_amount" numeric(19,2) not null, "balance_currency" char(3) not null, "version" int not null default 1, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "wallets" add constraint "wallets_player_id_currency_unique" unique ("player_id", "currency");`);

    this.addSql(`create table "wallet_ledger_entries" ("id" uuid not null, "wallet_id" uuid not null, "transaction_id" uuid not null, "direction" varchar(10) not null, "money_amount" numeric(19,2) not null, "money_currency" char(3) not null, "balance_before_amount" numeric(19,2) not null, "balance_before_currency" char(3) not null, "balance_after_amount" numeric(19,2) not null, "balance_after_currency" char(3) not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_transaction_id_wallet_id_unique" unique ("transaction_id", "wallet_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "inbox_messages" cascade;`);
    this.addSql(`drop table if exists "outbox_messages" cascade;`);
    this.addSql(`drop table if exists "wager_transactions" cascade;`);
    this.addSql(`drop table if exists "wallet_ledger_entries" cascade;`);
    this.addSql(`drop table if exists "wallets" cascade;`);
  }
}
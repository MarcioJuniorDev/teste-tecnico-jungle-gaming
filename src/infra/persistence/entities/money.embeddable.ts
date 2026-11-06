import { Embeddable, Property } from '@mikro-orm/decorators/legacy';

@Embeddable()
export class MoneyEmbeddable {
  @Property({
    type: 'decimal',
    precision: 19,
    scale: 2,
    columnType: 'numeric(19,2)',
    fieldName: 'amount',
  })
  amount!: string;

  @Property({
    type: 'string',
    length: 3,
    columnType: 'char(3)',
    fieldName: 'currency',
  })
  currency!: string;

  constructor(amount: string, currency: string) {
    this.amount = amount;
    this.currency = currency;
  }
}
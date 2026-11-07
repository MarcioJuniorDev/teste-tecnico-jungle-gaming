import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';

@Injectable()
export class DbHealthIndicator {
  constructor(private readonly em: EntityManager) {}

  async check(): Promise<'ok' | 'error'> {
    try {
      await this.em.execute('select 1');
      return 'ok';
    } catch {
      return 'error';
    }
  }
}
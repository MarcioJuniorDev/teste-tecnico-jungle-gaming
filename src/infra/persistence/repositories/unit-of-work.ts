import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { UnitOfWork } from '../../../application/ports/unit-of-work';

@Injectable()
export class MikroOrmUnitOfWork implements UnitOfWork {
  constructor(private readonly em: EntityManager) {}

  async run<T>(fn: (em: EntityManager) => Promise<T>): Promise<T> {
    return this.em.transactional((tx) => fn(tx));
  }
}
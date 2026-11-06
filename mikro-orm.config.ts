import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';

const config = defineConfig({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? '5432'),
  dbName: process.env.DB_NAME ?? 'wagering',
  user: process.env.DB_USER ?? 'wagering',
  password: process.env.DB_PASSWORD ?? 'wagering_dev',
  entities: ['./src/infra/persistence/entities/**/*.entity.ts'],
  entitiesTs: ['./src/infra/persistence/entities/**/*.entity.ts'],
  migrations: {
    path: './dist/migrations',
    pathTs: './migrations',
    transactional: true,
  },
  extensions: [Migrator],
  debug: process.env.MIKRO_ORM_DEBUG === '1',
});

export default config;

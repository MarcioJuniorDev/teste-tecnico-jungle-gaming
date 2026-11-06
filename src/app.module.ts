import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PersistenceModule } from './infra/persistence/mikro-orm.module';

@Module({
  imports: [PersistenceModule],
  controllers: [AppController],
})
export class AppModule {}
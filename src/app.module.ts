import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { HttpModule } from './interfaces/http/http.module';

@Module({
  imports: [HttpModule],
  controllers: [AppController],
})
export class AppModule {}
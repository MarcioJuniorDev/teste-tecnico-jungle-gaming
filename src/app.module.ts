import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AppController } from './app.controller';
import { HttpModule } from './interfaces/http/http.module';
import { ObservabilityModule } from './infra/observability/observability.module';
import {
  CORRELATION_ID_HEADER,
  CorrelationIdMiddleware,
} from './interfaces/http/middleware/correlation-id.middleware';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req) =>
          (req.headers[CORRELATION_ID_HEADER] as string | undefined) ?? randomUUID(),
        customProps: (req) => ({
          correlationId: (req as any).correlationId,
        }),
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers["idempotency-key"]',
            '*.money',
            '*.balance',
            '*.payload',
          ],
          remove: true,
        },
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
      },
    }),
    ObservabilityModule,
    HttpModule,
  ],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
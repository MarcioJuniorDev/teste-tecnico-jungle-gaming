import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DbHealthIndicator } from '../health/db.health-indicator';
import { SqsHealthIndicator } from '../health/sqs.health-indicator';

@Controller('health')
export class HealthController {
    constructor(
        private readonly db: DbHealthIndicator,
        private readonly sqs: SqsHealthIndicator,
    ) { }

    @Get('live')
    @HttpCode(HttpStatus.OK)
    live() {
        return { status: 'ok' };
    }

    @Get('ready')
    async ready(@Res({ passthrough: true }) res: Response) {
        const [db, sqs] = await Promise.all([this.db.check(), this.sqs.check()]);
        const ok = db === 'ok' && sqs === 'ok';
        res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
        return {
            status: ok ? 'ok' : 'error',
            checks: { db, sqs },
        };
    }
}
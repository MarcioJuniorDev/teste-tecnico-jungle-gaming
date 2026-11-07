import { Injectable } from '@nestjs/common';
import {
    GetQueueAttributesCommand,
    SQSClient,
} from '@aws-sdk/client-sqs';

@Injectable()
export class SqsHealthIndicator {
    private readonly client: SQSClient;
    private readonly queueUrl: string;

    constructor() {
        this.client = new SQSClient({
            endpoint: process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566',
            region: process.env.AWS_REGION ?? 'us-east-1',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
            },
        });
        this.queueUrl =
            process.env.SQS_QUEUE_URL ??
            'http://localhost:4566/000000000000/wager-transactions.fifo';
    }

    async check(): Promise<'ok' | 'error'> {
        try {
            await Promise.race([
                this.client.send(
                    new GetQueueAttributesCommand({
                        QueueUrl: this.queueUrl,
                        AttributeNames: ['ApproximateNumberOfMessages'],
                    }),
                ),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('sqs timeout')), 2000),
                ),
            ]);
            return 'ok';
        } catch {
            return 'error';
        }
    }
}
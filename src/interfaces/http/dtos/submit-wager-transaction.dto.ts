import { z } from 'zod';
import { WagerTransactionKind } from '../../../domain/wagering/wager-transaction-kind';

export const submitWagerTransactionSchema = z.object({
  providerId: z.string().min(1),
  externalTransactionId: z.string().min(1),
  playerId: z.string().uuid(),
  walletId: z.string().uuid(),
  roundId: z.string().min(1),
  gameId: z.string().min(1),
  kind: z.nativeEnum(WagerTransactionKind).refine(
    (k) =>
      k !== WagerTransactionKind.Opening,
    { message: 'OPENING cannot be submitted externally' },
  ),
  money: z.object({
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
    currency: z.string().length(3).regex(/^[A-Z]{3}$/),
  }),
  referenceExternalTransactionId: z.string().min(1).optional(),
});

export type SubmitWagerTransactionDto = z.infer<typeof submitWagerTransactionSchema>;
import { z } from 'zod';

export const createWalletSchema = z.object({
  playerId: z.string().uuid(),
  initialBalance: z.object({
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
    currency: z.string().length(3).regex(/^[A-Z]{3}$/),
  }),
});

export type CreateWalletDto = z.infer<typeof createWalletSchema>;
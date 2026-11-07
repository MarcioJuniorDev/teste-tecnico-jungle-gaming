export class WalletNotFoundError extends Error {
  constructor(public readonly walletId: string) {
    super(`wallet ${walletId} not found`);
    this.name = 'WalletNotFoundError';
  }
}
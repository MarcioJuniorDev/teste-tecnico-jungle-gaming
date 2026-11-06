export class WalletAlreadyExistsError extends Error {
  constructor(
    public readonly playerId: string,
    public readonly currency: string,
  ) {
    super(`wallet already exists for player ${playerId} in ${currency}`);
    this.name = 'WalletAlreadyExistsError';
  }
}
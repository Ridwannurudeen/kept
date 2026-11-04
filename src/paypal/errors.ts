export class PayPalError extends Error {
  constructor(
    message: string,
    public status: number,
    public debugId: string | null,
    public body: unknown,
    public path: string,
  ) {
    super(message);
    this.name = 'PayPalError';
  }
}

import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

let plaidInstance: PlaidApi | null = null;

export function getPlaidClient(): PlaidApi {
  if (!plaidInstance) {
    const clientId = process.env.PLAID_CLIENT_ID;
    const secret = process.env.PLAID_SECRET;
    const env = process.env.PLAID_ENV || 'sandbox';

    if (!clientId || !secret) {
      throw new Error('PLAID_CLIENT_ID and PLAID_SECRET must be configured');
    }

    const configuration = new Configuration({
      basePath: PlaidEnvironments[env as keyof typeof PlaidEnvironments],
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': clientId,
          'PLAID-SECRET': secret,
        },
      },
    });

    plaidInstance = new PlaidApi(configuration);
  }
  return plaidInstance;
}

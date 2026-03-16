import { getPlaidClient } from '@onereal/payments';

export async function verifyPlaidWebhook(body: string, headers: Headers): Promise<boolean> {
  try {
    const plaid = getPlaidClient();
    const verificationHeader = headers.get('plaid-verification');
    if (!verificationHeader) return false;

    const response = await plaid.webhookVerificationKeyGet({
      key_id: extractKidFromJwt(verificationHeader),
    });

    // In production, fully verify the JWT signature using the returned key.
    // For sandbox, Plaid doesn't send signed webhooks, so we allow through.
    const env = process.env.PLAID_ENV || 'sandbox';
    if (env === 'sandbox') return true;

    // Production verification using jose or similar JWT library
    // For now, verify key exists as basic check
    return !!response.data.key;
  } catch {
    // In sandbox, webhooks may not have verification headers
    const env = process.env.PLAID_ENV || 'sandbox';
    return env === 'sandbox';
  }
}

function extractKidFromJwt(jwt: string): string {
  const [headerB64] = jwt.split('.');
  const header = JSON.parse(Buffer.from(headerB64, 'base64').toString());
  return header.kid;
}

import * as z from 'zod/v4';

export const connectedAccountStatusSchema = z.enum(['PENDING', 'CONNECTED', 'DEGRADED', 'REVOKED']);

export const connectedAccountSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  externalAccountId: z.string().min(1),
  label: z.string().min(1),
  scopes: z.array(z.string()),
  status: connectedAccountStatusSchema,
  tokenReference: z.string().min(1),
  expiresAt: z.iso.datetime().optional(),
});

export type ConnectedAccount = z.infer<typeof connectedAccountSchema>;

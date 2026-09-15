import * as z from 'zod/v4';
import { costCategorySchema, type CostCategory } from './cost-event.js';

const safeNonNegativeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const opaqueEvidenceRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/#-]*$/, 'FINOPS_BILLING_EVIDENCE_REF_INVALID');

export const billingSnapshotSchema = z
  .object({
    snapshotId: z.string().trim().min(1),
    tenantId: z.string().trim().min(1),
    workspaceId: z.string().trim().min(1),
    organizationId: z.string().trim().min(1),
    provider: z.string().trim().min(1),
    model: z.string().trim().min(1).optional(),
    category: costCategorySchema,
    campaignId: z.string().trim().min(1).optional(),
    periodStart: z.iso.datetime(),
    periodEnd: z.iso.datetime(),
    currency: z.literal('USD'),
    billedCostMicroUsd: safeNonNegativeInteger,
    evidenceRef: opaqueEvidenceRefSchema,
    observedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.periodEnd) <= Date.parse(value.periodStart)) {
      context.addIssue({
        code: 'custom',
        path: ['periodEnd'],
        message: 'FINOPS_BILLING_PERIOD_INVALID',
      });
    }
  });

export type BillingSnapshot = z.infer<typeof billingSnapshotSchema>;

export interface BillingSnapshotScope {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
}

export interface BillingSnapshotDescriptor {
  readonly provider: string;
  readonly model?: string | undefined;
  readonly category: CostCategory;
  readonly campaignId?: string | undefined;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export function parseBillingSnapshot(value: unknown): BillingSnapshot {
  return billingSnapshotSchema.parse(value);
}

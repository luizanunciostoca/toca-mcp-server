import * as z from 'zod/v4';
import type { RiskClass } from '../core/tool-registry.js';
import { isRouteId, type RouteId } from '../governance/types.js';

export const AG01_APPROVAL_REQUIREMENTS = [
  'NONE',
  'POLICY_EVALUATION',
  'FORMAL_APPROVAL',
  'HUMAN_REVIEW',
] as const;
export type Ag01ApprovalRequirement = (typeof AG01_APPROVAL_REQUIREMENTS)[number];

export interface Ag01DecisionInputs {
  readonly summary: string;
  readonly payloadJson: string;
}

export interface Ag01DecisionStep {
  readonly stepId: string;
  readonly name: string;
  readonly capabilityId: string;
  readonly payloadJson: string;
  readonly maxAttempts: number;
}

export interface Ag01StructuredDecision {
  readonly routeId: RouteId;
  readonly agent: string;
  readonly intent: string;
  readonly inputs: Ag01DecisionInputs;
  readonly requiredArtifacts: readonly string[];
  readonly proposedCapability: string | null;
  readonly risk: RiskClass;
  readonly approvalRequirement: Ag01ApprovalRequirement;
  readonly expectedReadback: readonly string[];
  readonly confidence: number;
  readonly steps: readonly Ag01DecisionStep[];
  readonly humanEscalationReason: string | null;
}

const riskSchema = z.enum([
  'READ',
  'WRITE_REVERSIBLE',
  'WRITE_EXTERNAL',
  'FINANCIAL_IMPACT',
  'DESTRUCTIVE',
]);

const decisionSchema = z
  .object({
    routeId: z.string().min(1),
    agent: z.string().min(1),
    intent: z.string().min(1),
    inputs: z.object({
      summary: z.string().min(1),
      payloadJson: z.string().min(1),
    }),
    requiredArtifacts: z.array(z.string().min(1)).min(1).max(24),
    proposedCapability: z.string().min(1).nullable(),
    risk: riskSchema,
    approvalRequirement: z.enum(AG01_APPROVAL_REQUIREMENTS),
    expectedReadback: z.array(z.string().min(1)).max(24),
    confidence: z.number().min(0).max(1),
    steps: z
      .array(
        z.object({
          stepId: z.string().min(1).max(120),
          name: z.string().min(1).max(240),
          capabilityId: z.string().min(1).max(240),
          payloadJson: z.string().min(1),
          maxAttempts: z.number().int().min(1).max(5),
        }),
      )
      .max(12),
    humanEscalationReason: z.string().min(1).nullable(),
  })
  .strict();

export function parseAg01StructuredDecision(value: unknown): Ag01StructuredDecision {
  const parsed = decisionSchema.parse(value);
  if (!isRouteId(parsed.routeId)) throw new Error(`AG01_MODEL_ROUTE_INVALID:${parsed.routeId}`);
  if (parsed.steps.length === 0 && parsed.proposedCapability !== null) {
    throw new Error('AG01_MODEL_PROPOSED_CAPABILITY_WITHOUT_STEP');
  }
  if (parsed.steps.length > 0 && parsed.proposedCapability !== parsed.steps[0]?.capabilityId) {
    throw new Error('AG01_MODEL_PROPOSED_CAPABILITY_MISMATCH');
  }
  const stepIds = new Set<string>();
  for (const step of parsed.steps) {
    if (stepIds.has(step.stepId)) throw new Error(`AG01_MODEL_DUPLICATE_STEP_ID:${step.stepId}`);
    stepIds.add(step.stepId);
    parseJson(step.payloadJson, `AG01_MODEL_STEP_PAYLOAD_INVALID:${step.stepId}`);
  }
  parseJson(parsed.inputs.payloadJson, 'AG01_MODEL_INPUTS_PAYLOAD_INVALID');
  return parsed as Ag01StructuredDecision;
}

export function parseDecisionPayload(payloadJson: string): unknown {
  return parseJson(payloadJson, 'AG01_MODEL_STEP_PAYLOAD_INVALID');
}

function parseJson(value: string, errorCode: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(errorCode);
  }
}

export const AG01_DECISION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    routeId: { type: 'string' },
    agent: { type: 'string' },
    intent: { type: 'string' },
    inputs: {
      type: 'object',
      additionalProperties: false,
      properties: {
        summary: { type: 'string' },
        payloadJson: { type: 'string' },
      },
      required: ['summary', 'payloadJson'],
    },
    requiredArtifacts: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 24,
    },
    proposedCapability: { type: ['string', 'null'] },
    risk: {
      type: 'string',
      enum: ['READ', 'WRITE_REVERSIBLE', 'WRITE_EXTERNAL', 'FINANCIAL_IMPACT', 'DESTRUCTIVE'],
    },
    approvalRequirement: {
      type: 'string',
      enum: ['NONE', 'POLICY_EVALUATION', 'FORMAL_APPROVAL', 'HUMAN_REVIEW'],
    },
    expectedReadback: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 24,
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    steps: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stepId: { type: 'string' },
          name: { type: 'string' },
          capabilityId: { type: 'string' },
          payloadJson: { type: 'string' },
          maxAttempts: { type: 'integer', minimum: 1, maximum: 5 },
        },
        required: ['stepId', 'name', 'capabilityId', 'payloadJson', 'maxAttempts'],
      },
    },
    humanEscalationReason: { type: ['string', 'null'] },
  },
  required: [
    'routeId',
    'agent',
    'intent',
    'inputs',
    'requiredArtifacts',
    'proposedCapability',
    'risk',
    'approvalRequirement',
    'expectedReadback',
    'confidence',
    'steps',
    'humanEscalationReason',
  ],
} as const;

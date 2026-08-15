import { createHash } from 'node:crypto';
import type { GoogleAdsApiClient } from './google-ads-api-client.js';
import { normalizeCustomerId } from './google-ads-api-client.js';

export interface GoogleAdsGuardrails {
  readonly allowedCustomerId: string;
  readonly allowedCurrency: string;
  readonly maxDailyBudgetMicros: number;
  readonly currencyMinorUnitMicros: number;
  readonly allowedLocationCriterionIds?: readonly string[];
  readonly allowedLanguageCriterionIds?: readonly string[];
  readonly allowedAdvertisingChannelTypes?: readonly string[];
}

export interface GoogleAdsTargeting {
  readonly locationCriterionIds: readonly string[];
  readonly languageCriterionIds?: readonly string[];
  readonly presenceOnly?: boolean;
}

export interface GoogleAdsCampaignPlan {
  readonly customerId: string;
  readonly currencyCode: string;
  readonly campaignName: string;
  readonly budgetName: string;
  readonly dailyBudgetMicros: number;
  readonly advertisingChannelType?: 'SEARCH';
  readonly targeting: GoogleAdsTargeting;
}

export interface GoogleAdsPreparedCampaign {
  readonly status: 'VALIDATED_PAUSED_ONLY';
  readonly requestSha256: string;
  readonly plan: GoogleAdsCampaignPlan;
}

export interface GoogleAdsProviderReadback {
  readonly verified: boolean;
  readonly evidence: Record<string, unknown>;
}

export class GoogleAdsPaidMediaProvider {
  readonly #customerId: string;
  readonly #allowedCustomerId: string;

  constructor(
    private readonly api: GoogleAdsApiClient,
    private readonly guardrails: GoogleAdsGuardrails,
  ) {
    this.#customerId = normalizeCustomerId(guardrails.allowedCustomerId);
    this.#allowedCustomerId = this.#customerId;
    if (
      !Number.isSafeInteger(guardrails.maxDailyBudgetMicros) ||
      guardrails.maxDailyBudgetMicros <= 0
    ) {
      throw new Error('GOOGLE_ADS_MAX_BUDGET_INVALID');
    }
    if (
      !Number.isSafeInteger(guardrails.currencyMinorUnitMicros) ||
      guardrails.currencyMinorUnitMicros <= 0 ||
      1_000_000 % guardrails.currencyMinorUnitMicros !== 0
    ) {
      throw new Error('GOOGLE_ADS_CURRENCY_MINOR_UNIT_MICROS_INVALID');
    }
  }

  async inspectAccount(): Promise<Record<string, unknown>> {
    const accessible = await this.api.listAccessibleCustomers();
    const resourceName = `customers/${this.#customerId}`;
    if (!accessible.body.resourceNames?.includes(resourceName)) {
      throw new Error('GOOGLE_ADS_CUSTOMER_NOT_ACCESSIBLE');
    }
    const response = await this.api.search(
      'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.test_account FROM customer LIMIT 1',
    );
    return {
      customerId: this.#customerId,
      requestId: response.requestId,
      results: response.body.results ?? [],
    };
  }

  async listCampaigns(limit = 100): Promise<Record<string, unknown>> {
    assertLimit(limit);
    const response = await this.api.search(
      `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.campaign_budget, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED' ORDER BY campaign.id DESC LIMIT ${limit}`,
    );
    return { requestId: response.requestId, results: response.body.results ?? [] };
  }

  async getInsights(
    startDate: string,
    endDate: string,
    limit = 100,
  ): Promise<Record<string, unknown>> {
    assertIsoDate(startDate);
    assertIsoDate(endDate);
    assertLimit(limit);
    const response = await this.api.search(
      `SELECT campaign.id, campaign.name, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${startDate}' AND '${endDate}' ORDER BY segments.date DESC LIMIT ${limit}`,
    );
    return { requestId: response.requestId, results: response.body.results ?? [] };
  }

  async listConversionActions(limit = 100): Promise<Record<string, unknown>> {
    assertLimit(limit);
    const response = await this.api.search(
      `SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.type, conversion_action.category, conversion_action.primary_for_goal FROM conversion_action WHERE conversion_action.status != 'REMOVED' LIMIT ${limit}`,
    );
    return { requestId: response.requestId, results: response.body.results ?? [] };
  }

  prepare(plan: GoogleAdsCampaignPlan): GoogleAdsPreparedCampaign {
    const normalized = this.validatePlan(plan);
    return {
      status: 'VALIDATED_PAUSED_ONLY',
      requestSha256: stableSha256(normalized),
      plan: normalized,
    };
  }

  async validateTargeting(plan: GoogleAdsCampaignPlan): Promise<Record<string, unknown>> {
    const prepared = this.prepare(plan);
    const response = await this.api.mutate(`/customers/${this.#customerId}/googleAds:mutate`, {
      mutateOperations: buildCreateOperations(prepared.plan, this.#customerId),
      partialFailure: false,
      validateOnly: true,
      responseContentType: 'RESOURCE_NAME_ONLY',
    });
    return {
      valid: true,
      sideEffects: false,
      requestSha256: prepared.requestSha256,
      requestId: response.requestId,
    };
  }

  async createPaused(plan: GoogleAdsCampaignPlan): Promise<Record<string, unknown>> {
    const prepared = this.prepare(plan);
    const response = await this.api.mutate(`/customers/${this.#customerId}/googleAds:mutate`, {
      mutateOperations: buildCreateOperations(prepared.plan, this.#customerId),
      partialFailure: false,
      validateOnly: false,
      responseContentType: 'RESOURCE_NAME_ONLY',
    });
    return {
      status: 'PROVIDER_MUTATION_ACCEPTED',
      expectedCampaignStatus: 'PAUSED',
      requestSha256: prepared.requestSha256,
      requestId: response.requestId,
      response: response.body,
      campaignName: prepared.plan.campaignName,
      campaignResourceName: extractCreatedCampaignResourceName(response.body),
    };
  }

  readbackCampaign(campaignIdOrName: string): Promise<Record<string, unknown>> {
    const campaignId = campaignIdFromResourceName(campaignIdOrName);
    const numeric = /^\d+$/.test(campaignId);
    const predicate = numeric
      ? `campaign.id = ${campaignId}`
      : `campaign.name = '${escapeGaqlLiteral(campaignIdOrName)}'`;
    return this.api
      .search(
        `SELECT campaign.id, campaign.resource_name, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.campaign_budget, campaign_budget.amount_micros FROM campaign WHERE ${predicate} LIMIT 1`,
      )
      .then((response) => ({
        requestId: response.requestId,
        results: response.body.results ?? [],
      }));
  }

  async verifyPaused(campaignIdOrName: string): Promise<GoogleAdsProviderReadback> {
    const readback = await this.readbackCampaign(campaignIdOrName);
    const rows = readback.results as Array<Record<string, unknown>>;
    const campaign = rows[0]?.campaign as Record<string, unknown> | undefined;
    return {
      verified: campaign?.status === 'PAUSED',
      evidence: { campaignIdOrName, status: campaign?.status, readback },
    };
  }

  async readBudgetMicros(campaignId: string): Promise<number> {
    assertNumericId(campaignId, 'GOOGLE_ADS_CAMPAIGN_ID_INVALID');
    const readback = await this.readbackCampaign(campaignId);
    const rows = readback.results as Array<Record<string, unknown>>;
    const budget = rows[0]?.campaignBudget as Record<string, unknown> | undefined;
    const amount = Number(budget?.amountMicros);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error('GOOGLE_ADS_CAMPAIGN_BUDGET_AMOUNT_INVALID');
    }
    this.assertBudget(amount);
    return amount;
  }

  minorUnitsForMicros(amountMicros: number): number {
    this.assertBudget(amountMicros);
    return Math.ceil(amountMicros / this.guardrails.currencyMinorUnitMicros);
  }

  async activateCampaign(campaignId: string): Promise<Record<string, unknown>> {
    await this.readBudgetMicros(campaignId);
    return this.updateStatus(campaignId, 'ENABLED');
  }

  updateStatus(
    campaignId: string,
    status: 'ENABLED' | 'PAUSED',
  ): Promise<Record<string, unknown>> {
    assertNumericId(campaignId, 'GOOGLE_ADS_CAMPAIGN_ID_INVALID');
    return this.api
      .mutate(`/customers/${this.#customerId}/campaigns:mutate`, {
        operations: [
          {
            update: {
              resourceName: `customers/${this.#customerId}/campaigns/${campaignId}`,
              status,
            },
            updateMask: 'status',
          },
        ],
        partialFailure: false,
        validateOnly: false,
        responseContentType: 'RESOURCE_NAME_ONLY',
      })
      .then((response) => ({ status, requestId: response.requestId, response: response.body }));
  }

  async updateBudget(campaignId: string, amountMicros: number): Promise<Record<string, unknown>> {
    assertNumericId(campaignId, 'GOOGLE_ADS_CAMPAIGN_ID_INVALID');
    this.assertBudget(amountMicros);
    const readback = await this.readbackCampaign(campaignId);
    const rows = readback.results as Array<Record<string, unknown>>;
    const campaign = rows[0]?.campaign as Record<string, unknown> | undefined;
    const budgetResource = campaign?.campaignBudget;
    if (typeof budgetResource !== 'string') {
      throw new Error('GOOGLE_ADS_CAMPAIGN_BUDGET_NOT_FOUND');
    }
    const response = await this.api.mutate(`/customers/${this.#customerId}/campaignBudgets:mutate`, {
      operations: [
        {
          update: { resourceName: budgetResource, amountMicros },
          updateMask: 'amount_micros',
        },
      ],
      partialFailure: false,
      validateOnly: false,
      responseContentType: 'RESOURCE_NAME_ONLY',
    });
    return {
      amountMicros,
      budgetResource,
      requestId: response.requestId,
      response: response.body,
    };
  }

  spendMonitor(startDate: string, endDate: string): Promise<Record<string, unknown>> {
    return this.getInsights(startDate, endDate, 500);
  }

  async conversionsMonitor(startDate: string, endDate: string): Promise<Record<string, unknown>> {
    assertIsoDate(startDate);
    assertIsoDate(endDate);
    const response = await this.api.search(
      `SELECT campaign.id, campaign.name, segments.date, metrics.conversions, metrics.conversions_value, metrics.all_conversions, metrics.all_conversions_value FROM campaign WHERE segments.date BETWEEN '${startDate}' AND '${endDate}' ORDER BY segments.date DESC LIMIT 500`,
    );
    return { requestId: response.requestId, results: response.body.results ?? [] };
  }

  private validatePlan(plan: GoogleAdsCampaignPlan): GoogleAdsCampaignPlan {
    if (normalizeCustomerId(plan.customerId) !== this.#allowedCustomerId) {
      throw new Error('GOOGLE_ADS_CUSTOMER_GUARDRAIL_BLOCKED');
    }
    if (plan.currencyCode.toUpperCase() !== this.guardrails.allowedCurrency.toUpperCase()) {
      throw new Error('GOOGLE_ADS_CURRENCY_GUARDRAIL_BLOCKED');
    }
    if (!plan.campaignName.trim() || !plan.budgetName.trim()) {
      throw new Error('GOOGLE_ADS_NAME_REQUIRED');
    }
    this.assertBudget(plan.dailyBudgetMicros);
    const channel = plan.advertisingChannelType ?? 'SEARCH';
    const allowedChannels = this.guardrails.allowedAdvertisingChannelTypes ?? ['SEARCH'];
    if (!allowedChannels.includes(channel)) {
      throw new Error('GOOGLE_ADS_CHANNEL_GUARDRAIL_BLOCKED');
    }
    if (plan.targeting.locationCriterionIds.length === 0) {
      throw new Error('GOOGLE_ADS_LOCATION_TARGET_REQUIRED');
    }
    assertCriterionAllowlist(
      plan.targeting.locationCriterionIds,
      this.guardrails.allowedLocationCriterionIds,
      'GOOGLE_ADS_LOCATION_GUARDRAIL_BLOCKED',
    );
    assertCriterionAllowlist(
      plan.targeting.languageCriterionIds ?? [],
      this.guardrails.allowedLanguageCriterionIds,
      'GOOGLE_ADS_LANGUAGE_GUARDRAIL_BLOCKED',
    );
    return {
      ...plan,
      customerId: this.#customerId,
      currencyCode: plan.currencyCode.toUpperCase(),
      advertisingChannelType: channel,
      campaignName: plan.campaignName.trim(),
      budgetName: plan.budgetName.trim(),
    };
  }

  private assertBudget(amountMicros: number): void {
    if (!Number.isSafeInteger(amountMicros) || amountMicros <= 0) {
      throw new Error('GOOGLE_ADS_BUDGET_INVALID');
    }
    if (amountMicros > this.guardrails.maxDailyBudgetMicros) {
      throw new Error('GOOGLE_ADS_BUDGET_CEILING_EXCEEDED');
    }
  }
}

function buildCreateOperations(
  plan: GoogleAdsCampaignPlan,
  customerId: string,
): Record<string, unknown>[] {
  const budgetResourceName = `customers/${customerId}/campaignBudgets/-1`;
  const campaignResourceName = `customers/${customerId}/campaigns/-2`;
  const geoTargetTypeSetting = plan.targeting.presenceOnly
    ? { positiveGeoTargetType: 'PRESENCE', negativeGeoTargetType: 'PRESENCE' }
    : { positiveGeoTargetType: 'PRESENCE_OR_INTEREST', negativeGeoTargetType: 'PRESENCE' };
  const operations: Record<string, unknown>[] = [
    {
      campaignBudgetOperation: {
        create: {
          resourceName: budgetResourceName,
          name: plan.budgetName,
          deliveryMethod: 'STANDARD',
          amountMicros: plan.dailyBudgetMicros,
          explicitlyShared: false,
        },
      },
    },
    {
      campaignOperation: {
        create: {
          resourceName: campaignResourceName,
          name: plan.campaignName,
          campaignBudget: budgetResourceName,
          advertisingChannelType: plan.advertisingChannelType ?? 'SEARCH',
          status: 'PAUSED',
          manualCpc: {},
          geoTargetTypeSetting,
          networkSettings: {
            targetGoogleSearch: true,
            targetSearchNetwork: true,
            targetContentNetwork: false,
            targetPartnerSearchNetwork: false,
          },
        },
      },
    },
  ];
  for (const locationId of plan.targeting.locationCriterionIds) {
    assertNumericId(locationId, 'GOOGLE_ADS_LOCATION_CRITERION_INVALID');
    operations.push({
      campaignCriterionOperation: {
        create: {
          campaign: campaignResourceName,
          location: { geoTargetConstant: `geoTargetConstants/${locationId}` },
        },
      },
    });
  }
  for (const languageId of plan.targeting.languageCriterionIds ?? []) {
    assertNumericId(languageId, 'GOOGLE_ADS_LANGUAGE_CRITERION_INVALID');
    operations.push({
      campaignCriterionOperation: {
        create: {
          campaign: campaignResourceName,
          language: { languageConstant: `languageConstants/${languageId}` },
        },
      },
    });
  }
  return operations;
}

function extractCreatedCampaignResourceName(body: Record<string, unknown>): string | undefined {
  const responses = body.mutateOperationResponses;
  if (!Array.isArray(responses)) return undefined;
  for (const response of responses) {
    if (!response || typeof response !== 'object') continue;
    const campaignResult = (response as Record<string, unknown>).campaignResult;
    if (!campaignResult || typeof campaignResult !== 'object') continue;
    const resourceName = (campaignResult as Record<string, unknown>).resourceName;
    if (typeof resourceName === 'string') return resourceName;
  }
  return undefined;
}

function campaignIdFromResourceName(value: string): string {
  const match = /\/campaigns\/(\d+)$/.exec(value);
  return match?.[1] ?? value;
}

function assertCriterionAllowlist(
  values: readonly string[],
  allowed: readonly string[] | undefined,
  error: string,
): void {
  for (const value of values) {
    assertNumericId(value, error);
    if (allowed && !allowed.includes(value)) throw new Error(error);
  }
}

function assertNumericId(value: string, error: string): void {
  if (!/^\d+$/.test(value)) throw new Error(error);
}

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('GOOGLE_ADS_LIMIT_INVALID');
  }
}

function assertIsoDate(value: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  ) {
    throw new Error('GOOGLE_ADS_DATE_INVALID');
  }
}

function escapeGaqlLiteral(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function stableSha256(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

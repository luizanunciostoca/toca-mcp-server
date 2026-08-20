from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"PATTERN_NOT_FOUND:{path}:{old[:100]}")
    p.write_text(text.replace(old, new, 1))


replace(
    "src/providers/sendgrid/email-provider.ts",
    """  readonly eventWebhookPublicKeyPem?: string | null;\n  readonly inboundParsePublicKeyPem?: string | null;\n  readonly emailActivityReadbackEnabled?: boolean;\n""",
    """  readonly eventWebhookPublicKeyPem?: string | null;\n  readonly inboundParseEnabled?: boolean;\n  readonly inboundParseHostname?: string | null;\n  readonly inboundParsePublicKeyPem?: string | null;\n  readonly emailActivityReadbackEnabled?: boolean;\n""",
)

replace(
    "src/providers/sendgrid/email-provider.ts",
    """type FetchLike = typeof fetch;\n\nexport class SendGridEmailProvider implements EmailProviderAdapter {\n""",
    """type FetchLike = typeof fetch;\n\nexport class SendGridHttpError extends Error {\n  constructor(\n    readonly status: number,\n    readonly retryAfterMs: number | null,\n    readonly providerBodyEvidence: string,\n  ) {\n    super(`SENDGRID_MAIL_SEND_FAILED:${status}`);\n    this.name = 'SendGridHttpError';\n  }\n}\n\nexport class SendGridEmailProvider implements EmailProviderAdapter {\n""",
)

replace(
    "src/providers/sendgrid/email-provider.ts",
    """    if (response.status !== 202) {\n      throw new Error(\n        `SENDGRID_MAIL_SEND_FAILED:${response.status}:${await safeResponseText(response)}`,\n      );\n    }\n""",
    """    if (response.status !== 202) {\n      throw new SendGridHttpError(\n        response.status,\n        parseRetryAfterMs(response.headers.get('retry-after')),\n        await safeResponseText(response),\n      );\n    }\n""",
)

mx_marker = "export function validateSendGridConfig(config: SendGridConfig): void {\n"
mx_block = """export async function validateSendGridInboundMx(hostname: string): Promise<{\n  readonly hostname: string;\n  readonly mx: 'PASS' | 'FAIL';\n  readonly evidence: readonly string[];\n}> {\n  const normalizedHostname = normalizeDomain(hostname);\n  try {\n    const records = await dns.resolveMx(normalizedHostname);\n    const matching = records.filter(\n      (record) => normalizeDomain(record.exchange) === 'mx.sendgrid.net',\n    );\n    const passed = matching.length > 0;\n    return {\n      hostname: normalizedHostname,\n      mx: passed ? 'PASS' : 'FAIL',\n      evidence: [\n        `dns:inbound-mx:${passed ? 'PASS' : 'FAIL'}:${records\n          .map((record) => `${record.priority}:${record.exchange}`)\n          .join(',') || 'missing'}`,\n      ],\n    };\n  } catch (error) {\n    return {\n      hostname: normalizedHostname,\n      mx: 'FAIL',\n      evidence: [`dns:inbound-mx:FAIL:${errorCode(error)}`],\n    };\n  }\n}\n\n"""
replace("src/providers/sendgrid/email-provider.ts", mx_marker, mx_block + mx_marker)

replace(
    "src/providers/sendgrid/email-provider.ts",
    """  if (config.replyToEmail) normalizeEmailAddress(config.replyToEmail);\n  if (config.apiBaseUrl && !/^https:\\/\\//i.test(config.apiBaseUrl)) {\n""",
    """  if (config.replyToEmail) normalizeEmailAddress(config.replyToEmail);\n  if (config.inboundParseEnabled) {\n    if (!config.inboundParseHostname?.trim()) {\n      throw new Error('SENDGRID_INBOUND_PARSE_HOSTNAME_REQUIRED');\n    }\n    normalizeDomain(config.inboundParseHostname);\n    if (!config.inboundParsePublicKeyPem?.trim()) {\n      throw new Error('SENDGRID_INBOUND_PARSE_PUBLIC_KEY_REQUIRED');\n    }\n  }\n  if (config.apiBaseUrl && !/^https:\\/\\//i.test(config.apiBaseUrl)) {\n""",
)

replace(
    "src/providers/sendgrid/email-provider.ts",
    """function errorCode(error: unknown): string {\n  return error instanceof Error ? error.message : String(error);\n}\n""",
    """function parseRetryAfterMs(value: string | null): number | null {\n  if (!value?.trim()) return null;\n  const normalized = value.trim();\n  if (/^\\d+$/.test(normalized)) return Number.parseInt(normalized, 10) * 1_000;\n  const dateMs = Date.parse(normalized);\n  if (!Number.isFinite(dateMs)) return null;\n  return Math.max(0, dateMs - Date.now());\n}\n\nfunction errorCode(error: unknown): string {\n  return error instanceof Error ? error.message : String(error);\n}\n""",
)

replace(
    "src/omnichannel/email-orchestrator.ts",
    """        const delayMs = computeEmailRetryDelayMs(attemptCount, null, retryPolicy);\n""",
    """        const delayMs = computeEmailRetryDelayMs(\n          attemptCount,\n          providerRetryAfterMs(error),\n          retryPolicy,\n        );\n""",
)
replace(
    "src/omnichannel/email-orchestrator.ts",
    """function safeErrorCode(error: unknown): string {\n""",
    """function providerRetryAfterMs(error: unknown): number | null {\n  if (!error || typeof error !== 'object' || !('retryAfterMs' in error)) return null;\n  const value = (error as { readonly retryAfterMs?: unknown }).retryAfterMs;\n  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;\n}\n\nfunction safeErrorCode(error: unknown): string {\n""",
)

replace(
    "src/providers/sendgrid/runtime-config.ts",
    """    eventWebhookPublicKeyPem: nullableEnv(env.EMAIL_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY_PEM),\n    inboundParsePublicKeyPem: nullableEnv(env.EMAIL_SENDGRID_INBOUND_PARSE_PUBLIC_KEY_PEM),\n    emailActivityReadbackEnabled: parseBoolean(\n""",
    """    eventWebhookPublicKeyPem: nullableEnv(env.EMAIL_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY_PEM),\n    inboundParseEnabled: parseBoolean(\n      env.EMAIL_SENDGRID_INBOUND_PARSE_ENABLED,\n      false,\n      'EMAIL_SENDGRID_INBOUND_PARSE_ENABLED_INVALID',\n    ),\n    inboundParseHostname: nullableEnv(env.EMAIL_SENDGRID_INBOUND_PARSE_HOSTNAME),\n    inboundParsePublicKeyPem: nullableEnv(env.EMAIL_SENDGRID_INBOUND_PARSE_PUBLIC_KEY_PEM),\n    emailActivityReadbackEnabled: parseBoolean(\n""",
)

replace(
    "scripts/validate-sendgrid-email.ts",
    """  SendGridEmailProvider,\n  validateSendGridDns,\n""",
    """  SendGridEmailProvider,\n  validateSendGridDns,\n  validateSendGridInboundMx,\n""",
)
replace(
    "scripts/validate-sendgrid-email.ts",
    """const [providerReadback, dnsReadback] = await Promise.all([\n  provider.validateCredentialsAndDomain(),\n  validateSendGridDns({\n    sendingDomain: loaded.config.sendingDomain,\n    expectedDkimRecords: loaded.expectedDkimRecords,\n    expectedSpfInclude: loaded.expectedSpfInclude,\n  }),\n]);\n\nconst gates = {\n""",
    """const [providerReadback, dnsReadback, inboundMxReadback] = await Promise.all([\n  provider.validateCredentialsAndDomain(),\n  validateSendGridDns({\n    sendingDomain: loaded.config.sendingDomain,\n    expectedDkimRecords: loaded.expectedDkimRecords,\n    expectedSpfInclude: loaded.expectedSpfInclude,\n  }),\n  loaded.config.inboundParseEnabled && loaded.config.inboundParseHostname\n    ? validateSendGridInboundMx(loaded.config.inboundParseHostname)\n    : Promise.resolve(null),\n]);\n\nconst inboundEnabled = loaded.config.inboundParseEnabled === true;\nconst gates = {\n""",
)
replace(
    "scripts/validate-sendgrid-email.ts",
    """  event_webhook_signature_key: Boolean(loaded.config.eventWebhookPublicKeyPem?.trim()),\n  inbound_parse_signature_key: Boolean(loaded.config.inboundParsePublicKeyPem?.trim()),\n  independent_provider_readback: loaded.config.emailActivityReadbackEnabled === true,\n""",
    """  event_webhook_signature_key: Boolean(loaded.config.eventWebhookPublicKeyPem?.trim()),\n  inbound_parse_hostname:\n    !inboundEnabled || Boolean(loaded.config.inboundParseHostname?.trim()),\n  inbound_parse_signature_key:\n    !inboundEnabled || Boolean(loaded.config.inboundParsePublicKeyPem?.trim()),\n  inbound_parse_mx: !inboundEnabled || inboundMxReadback?.mx === 'PASS',\n  independent_provider_readback: loaded.config.emailActivityReadbackEnabled === true,\n""",
)
replace(
    "scripts/validate-sendgrid-email.ts",
    """      evidence: [...providerReadback.evidence, ...dnsReadback.evidence],\n""",
    """      evidence: [\n        ...providerReadback.evidence,\n        ...dnsReadback.evidence,\n        ...(inboundMxReadback?.evidence ?? []),\n      ],\n""",
)

replace(
    ".env.example",
    """EMAIL_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY_PEM=\nEMAIL_SENDGRID_INBOUND_PARSE_PUBLIC_KEY_PEM=\nEMAIL_SENDGRID_EMAIL_ACTIVITY_READBACK_ENABLED=false\n""",
    """EMAIL_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY_PEM=\nEMAIL_SENDGRID_INBOUND_PARSE_ENABLED=false\nEMAIL_SENDGRID_INBOUND_PARSE_HOSTNAME=\nEMAIL_SENDGRID_INBOUND_PARSE_PUBLIC_KEY_PEM=\nEMAIL_SENDGRID_EMAIL_ACTIVITY_READBACK_ENABLED=false\n""",
)

replace(
    "test/email-orchestrator.test.ts",
    """    provider.sendError = new Error('SENDGRID_MAIL_SEND_FAILED:429:rate-limited');\n    const coordinator = new EmailDispatchCoordinator(provider, store);\n    const result = await coordinator.send(buildSendInput());\n    expect(result.dispatch.state).toBe('DEFERRED');\n    expect(result.dispatch.attemptCount).toBe(1);\n    expect(result.dispatch.nextRetryAt).toBe('2026-08-20T05:00:01.000Z');\n  });\n""",
    """    provider.sendError = Object.assign(new Error('SENDGRID_MAIL_SEND_FAILED:429'), {\n      retryAfterMs: 5_000,\n    });\n    const coordinator = new EmailDispatchCoordinator(provider, store);\n    const result = await coordinator.send(buildSendInput());\n    expect(result.dispatch.state).toBe('DEFERRED');\n    expect(result.dispatch.attemptCount).toBe(1);\n    expect(result.dispatch.nextRetryAt).toBe('2026-08-20T05:00:05.000Z');\n  });\n\n  it('falls back to exponential retry when provider Retry-After is absent', async () => {\n    const store = new MemoryEmailStore();\n    const provider = new StubProvider();\n    provider.sendError = new Error('SENDGRID_MAIL_SEND_FAILED:500');\n    const coordinator = new EmailDispatchCoordinator(provider, store);\n    const result = await coordinator.send(buildSendInput());\n    expect(result.dispatch.state).toBe('DEFERRED');\n    expect(result.dispatch.nextRetryAt).toBe('2026-08-20T05:00:01.000Z');\n  });\n""",
)

replace(
    "test/sendgrid-email-provider.test.ts",
    """  it('fails closed when independent Email Activity readback is not enabled', async () => {\n""",
    """  it('preserves Retry-After from transient provider rejection', async () => {\n    const provider = new SendGridEmailProvider(\n      productionConfig,\n      resolver,\n      fakeFetchReturning(\n        new Response('{\\"errors\\":[{\\"message\\":\\"rate limited\\"}]}', {\n          status: 429,\n          headers: { 'Retry-After': '7' },\n        }),\n      ),\n    );\n    await expect(\n      provider.sendCampaign({\n        tenantId: 'tenant-1',\n        workspaceId: 'workspace-1',\n        organizationId: 'org-1',\n        correlationId: 'corr-1',\n        preparedCampaignRef: 'prepared-1',\n        eligibilitySnapshot: {\n          tenantId: 'tenant-1',\n          workspaceId: 'workspace-1',\n          organizationId: 'org-1',\n          correlationId: 'corr-1',\n          snapshotId: 'audience-1',\n          purposeId: 'reservation-followup',\n          resolvedContactCount: 1,\n          ambiguousContactCount: 0,\n          unresolvedContactCount: 0,\n          privacyUnknownBlockedCount: 0,\n          privacySuppressedCount: 0,\n          policyDeniedCount: 0,\n        },\n        approval: {\n          tenantId: 'tenant-1',\n          workspaceId: 'workspace-1',\n          organizationId: 'org-1',\n          correlationId: 'corr-1',\n          approvalId: 'approval-1',\n          status: 'APPROVED',\n        },\n        idempotencyKey: 'idem-retry-after',\n      }),\n    ).rejects.toMatchObject({ status: 429, retryAfterMs: 7_000 });\n  });\n\n  it('requires inbound hostname and signing key only when inbound parse is enabled', () => {\n    expect(() =>\n      validateSendGridConfig({ ...productionConfig, inboundParseEnabled: false }),\n    ).not.toThrow();\n    expect(() =>\n      validateSendGridConfig({ ...productionConfig, inboundParseEnabled: true }),\n    ).toThrow('SENDGRID_INBOUND_PARSE_HOSTNAME_REQUIRED');\n    expect(() =>\n      validateSendGridConfig({\n        ...productionConfig,\n        inboundParseEnabled: true,\n        inboundParseHostname: 'inbound.mail.example.com',\n      }),\n    ).toThrow('SENDGRID_INBOUND_PARSE_PUBLIC_KEY_REQUIRED');\n  });\n\n  it('fails closed when independent Email Activity readback is not enabled', async () => {\n""",
)

replace(
    "docs/checkpoints/email-real-sendgrid-2026-08-20.md",
    "- Bounded exponential retry primitives with provider `Retry-After` support.\n",
    "- Bounded exponential retry with provider `Retry-After` honored for transient failures.\n",
)
replace(
    "docs/checkpoints/email-real-sendgrid-2026-08-20.md",
    "9. Inbound Parse public key is configured when inbound email is enabled.\n10. Independent Email Activity readback is enabled.\n",
    "9. When inbound email is enabled, its receiving hostname is configured, MX resolves to `mx.sendgrid.net`, and the Inbound Parse signing key is configured.\n10. Independent Email Activity readback is enabled.\n",
)

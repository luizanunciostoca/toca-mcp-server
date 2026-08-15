import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(path, before, after) {
  const current = readFileSync(path, 'utf8');
  if (current.includes(after)) return;
  const first = current.indexOf(before);
  if (first === -1) throw new Error(`PATCH_SOURCE_NOT_FOUND:${path}`);
  if (current.indexOf(before, first + before.length) !== -1) {
    throw new Error(`PATCH_SOURCE_NOT_UNIQUE:${path}`);
  }
  writeFileSync(path, current.replace(before, after));
}

replaceOnce(
  'src/local-discovery/google-business.ts',
  `function stableValue(value: unknown): string {\n  if (value === null || typeof value !== 'object') return JSON.stringify(value);\n  if (Array.isArray(value)) return JSON.stringify(value.map((item) => JSON.parse(stableValue(item))));\n`,
  `function stableValue(value: unknown): string {\n  if (value === undefined) return '"__undefined__"';\n  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? '"__unsupported__"';\n  if (Array.isArray(value)) return JSON.stringify(value.map((item) => JSON.parse(stableValue(item))));\n`,
);

replaceOnce(
  'src/governance/route-catalog.ts',
  `    subflows: [\n      'LANCAMENTO',\n      'EVENTO',\n      'AWARENESS',\n      'VENDAS',\n      'REATIVACAO',\n      'PROMOCAO',\n      'BRANDING',\n      'PARCERIAS',\n      'INFLUENCER',\n    ],\n    initialState: 'BRIEF_REQUIRED',\n`,
  `    subflows: [\n      'LANCAMENTO',\n      'EVENTO',\n      'AWARENESS',\n      'VENDAS',\n      'REATIVACAO',\n      'PROMOCAO',\n      'BRANDING',\n      'PARCERIAS',\n      'INFLUENCER',\n      'LOCAL_DISCOVERY',\n      'GOOGLE_EVENT_POST',\n      'PROFILE_FRESHNESS',\n    ],\n    initialState: 'BRIEF_REQUIRED',\n`,
);
replaceOnce(
  'src/governance/route-catalog.ts',
  `    subflows: [\n      'ELOGIO',\n      'DUVIDA',\n      'PRECO',\n      'HORARIO',\n      'LOCALIZACAO',\n      'RESERVA',\n      'RECLAMACAO',\n      'CRISE',\n      'SPAM',\n      'PARCERIA',\n      'LEAD',\n      'INFLUENCER',\n      'IMPRENSA',\n      'VIP',\n    ],\n    initialState: 'RECEIVED',\n`,
  `    subflows: [\n      'ELOGIO',\n      'DUVIDA',\n      'PRECO',\n      'HORARIO',\n      'LOCALIZACAO',\n      'RESERVA',\n      'RECLAMACAO',\n      'CRISE',\n      'SPAM',\n      'PARCERIA',\n      'LEAD',\n      'INFLUENCER',\n      'IMPRENSA',\n      'VIP',\n      'REVIEW_RESPONSE',\n    ],\n    initialState: 'RECEIVED',\n`,
);
replaceOnce(
  'src/governance/route-catalog.ts',
  `    subflows: [\n      'ORGANIC_CONTENT',\n      'PAID_MEDIA',\n      'TIMING',\n      'CREATIVE',\n      'COPY',\n      'AUDIENCE',\n      'EXPERIMENTATION',\n    ],\n    initialState: 'HYPOTHESIS',\n`,
  `    subflows: [\n      'ORGANIC_CONTENT',\n      'PAID_MEDIA',\n      'TIMING',\n      'CREATIVE',\n      'COPY',\n      'AUDIENCE',\n      'EXPERIMENTATION',\n      'LOCAL_PERFORMANCE',\n    ],\n    initialState: 'HYPOTHESIS',\n`,
);

replaceOnce(
  'src/governance/capability-ids.ts',
  `  R08: ['meta_ads.accounts.list', 'meta_ads.campaign.prepare_paused'],\n`,
  `  R07: [\n    'google_business.location.read',\n    'google_business.location.validate',\n    'google_business.hours.reconcile',\n    'google_business.post.prepare',\n    'google_business.post.create',\n    'google_business.post.readback',\n    'google_business.profile.drift.detect',\n  ],\n  R08: ['meta_ads.accounts.list', 'meta_ads.campaign.prepare_paused'],\n`,
);
replaceOnce(
  'src/governance/capability-ids.ts',
  `  R19: [\n    'instagram.toca_schedule.prepare',\n    'instagram.toca_schedule.create',\n    'instagram.toca_schedule.reschedule',\n    'instagram.toca_schedule.cancel',\n    'instagram.toca_schedule.status',\n    'instagram.toca_schedule.list',\n  ],\n};\n`,
  `  R19: [\n    'instagram.toca_schedule.prepare',\n    'instagram.toca_schedule.create',\n    'instagram.toca_schedule.reschedule',\n    'instagram.toca_schedule.cancel',\n    'instagram.toca_schedule.status',\n    'instagram.toca_schedule.list',\n  ],\n  R30: [\n    'google_business.review.ingest',\n    'google_business.review.classify',\n    'google_business.review.reply_draft',\n    'google_business.review.reply',\n    'google_business.review.verify',\n    'google_business.notification.ingest',\n  ],\n  R31: ['google_business.performance.read'],\n};\n`,
);

replaceOnce(
  'src/governance/capability-catalog.ts',
  `  'release.close',\n  'approval.request',\n`,
  `  'release.close',\n  'google_business.location.read',\n  'google_business.location.validate',\n  'google_business.hours.reconcile',\n  'google_business.post.prepare',\n  'google_business.post.create',\n  'google_business.post.readback',\n  'google_business.review.ingest',\n  'google_business.review.classify',\n  'google_business.review.reply_draft',\n  'google_business.review.reply',\n  'google_business.review.verify',\n  'google_business.notification.ingest',\n  'google_business.performance.read',\n  'google_business.profile.drift.detect',\n  'approval.request',\n`,
);
replaceOnce(
  'src/governance/capability-catalog.ts',
  `function isProviderWrite(capabilityId: string): boolean {\n  if (/^meta_ads\\./.test(capabilityId)) return isMutationAction(capabilityId);\n  if (/^(instagram|social|engagement)\\./.test(capabilityId)) {\n`,
  `function isProviderWrite(capabilityId: string): boolean {\n  if (/^meta_ads\\./.test(capabilityId)) return isMutationAction(capabilityId);\n  if (/^google_business\\./.test(capabilityId)) {\n    return (\n      capabilityId === 'google_business.post.create' ||\n      capabilityId === 'google_business.review.reply'\n    );\n  }\n  if (/^(instagram|social|engagement)\\./.test(capabilityId)) {\n`,
);
replaceOnce(
  'src/governance/capability-catalog.ts',
  `function inferredProvider(capabilityId: string): string {\n  if (/^meta_ads\\./.test(capabilityId)) return 'Meta Marketing API';\n  if (/^(instagram|social|engagement)\\./.test(capabilityId)) return 'Meta/Instagram';\n`,
  `function inferredProvider(capabilityId: string): string {\n  if (/^meta_ads\\./.test(capabilityId)) return 'Meta Marketing API';\n  if (/^google_business\\./.test(capabilityId)) return 'Google Business Profile';\n  if (/^(instagram|social|engagement)\\./.test(capabilityId)) return 'Meta/Instagram';\n`,
);
replaceOnce(
  'src/governance/capability-catalog.ts',
  `  if (capabilityId.startsWith('drive.')) return 'OAUTH2';\n  if (/^(instagram|social|engagement|meta_ads)\\./.test(capabilityId)) return 'UNKNOWN';\n`,
  `  if (capabilityId.startsWith('drive.')) return 'OAUTH2';\n  if (capabilityId.startsWith('google_business.')) return 'OAUTH2';\n  if (/^(instagram|social|engagement|meta_ads)\\./.test(capabilityId)) return 'UNKNOWN';\n`,
);
replaceOnce(
  'src/governance/capability-catalog.ts',
  `  const external = /^(instagram|meta_ads|social|engagement|drive|release|security)\\./.test(\n`,
  `  const external = /^(instagram|meta_ads|social|engagement|google_business|drive|release|security)\\./.test(\n`,
);
replaceOnce(
  'src/governance/capability-catalog.ts',
  `  if (knownRuntimeTools.has(capabilityId)) return ['src/registry.ts'];\n  if (capabilityId.startsWith('approval.')) return ['src/governance/approval-governance.ts'];\n`,
  `  if (knownRuntimeTools.has(capabilityId)) return ['src/registry.ts'];\n  if (capabilityId.startsWith('google_business.')) {\n    return ['src/local-discovery/google-business.ts'];\n  }\n  if (capabilityId.startsWith('approval.')) return ['src/governance/approval-governance.ts'];\n`,
);

replaceOnce(
  'src/governance/capability-contract-overrides.ts',
  `const META_OFFICIAL_POSTMAN_EVIDENCE = [\n  'Meta official Instagram API Postman workspace — Instagram Login and Facebook Login permission model, validated 2026-08-14',\n];\n`,
  `const META_OFFICIAL_POSTMAN_EVIDENCE = [\n  'Meta official Instagram API Postman workspace — Instagram Login and Facebook Login permission model, validated 2026-08-14',\n];\nconst GOOGLE_BUSINESS_PERMISSION_VALIDATED_AT = '2026-08-15';\nconst GOOGLE_BUSINESS_SCOPE = 'https://www.googleapis.com/auth/business.manage';\nconst GOOGLE_BUSINESS_OFFICIAL_EVIDENCE = [\n  'Google Business Profile official API documentation — OAuth, Business Information, Local Posts, Reviews, Notifications and Performance, validated 2026-08-15',\n];\n\nfunction googleBusinessPermissionRequirements(\n  operation: string,\n  accessLevel: ProviderPermissionRequirement['access_level'],\n): readonly ProviderPermissionRequirement[] {\n  return [\n    {\n      provider: 'Google Business Profile',\n      authentication_mode: 'OAUTH2',\n      operation,\n      scopes: [GOOGLE_BUSINESS_SCOPE],\n      access_level: accessLevel,\n      validated_at: GOOGLE_BUSINESS_PERMISSION_VALIDATED_AT,\n      evidence: GOOGLE_BUSINESS_OFFICIAL_EVIDENCE,\n    },\n  ];\n}\n`,
);
replaceOnce(
  'src/governance/capability-contract-overrides.ts',
  `  'story.export': {\n    description: 'Export a Story artifact from an approved content definition.',\n`,
  `  'google_business.location.read': {\n    description: 'Read the current Google Business Profile location snapshot using an explicit read mask.',\n    risk_class: 'READ',\n    side_effects: false,\n    approval_required: false,\n    idempotent: true,\n    provider: 'Google Business Profile',\n    operation: 'businessinformation.locations.get',\n    authentication_mode: 'OAUTH2',\n    required_scopes: [GOOGLE_BUSINESS_SCOPE],\n    permission_requirements: googleBusinessPermissionRequirements(\n      'businessinformation.locations.get',\n      'READ',\n    ),\n    verification_method: 'PROVIDER_RESPONSE_SCHEMA_VALIDATION',\n    rollback_method: 'NOT_APPLICABLE',\n  },\n  'google_business.location.validate': {\n    description: 'Validate a normalized Google Business location snapshot against canonical local-discovery expectations.',\n    risk_class: 'READ',\n    side_effects: false,\n    approval_required: false,\n    idempotent: true,\n    provider: 'TOCA_OS+toca-mcp',\n    operation: 'google_business.location.validate',\n    authentication_mode: 'INTERNAL',\n    required_scopes: [],\n    verification_method: 'DETERMINISTIC_PROFILE_VALIDATION',\n    rollback_method: 'NOT_APPLICABLE',\n  },\n  'google_business.hours.reconcile': {\n    description: 'Compare canonical and provider hours and return a read-only reconciliation plan without mutating Google.',\n    risk_class: 'READ',\n    side_effects: false,\n    approval_required: false,\n    idempotent: true,\n    provider: 'TOCA_OS+toca-mcp',\n    operation: 'google_business.hours.reconcile',\n    authentication_mode: 'INTERNAL',\n    required_scopes: [],\n    verification_method: 'DETERMINISTIC_HOURS_DIFF',\n    rollback_method: 'NOT_APPLICABLE',\n  },\n  'google_business.post.prepare': {\n    description: 'Prepare a local post draft and bind event posts to the canonical EventRecord when applicable.',\n    risk_class: 'READ',\n    side_effects: false,\n    approval_required: false,\n    idempotent: true,\n    provider: 'TOCA_OS+toca-mcp',\n    operation: 'google_business.post.prepare',\n    authentication_mode: 'INTERNAL',\n    required_scopes: [],\n    verification_method: 'DRAFT_AND_EVENT_RECORD_VALIDATION',\n    rollback_method: 'NOT_APPLICABLE',\n  },\n  'google_business.post.create': {\n    description: 'Create a Google Business Profile Local Post only through R27 approval and mandatory provider read-back.',\n    risk_class: 'WRITE_EXTERNAL',\n    side_effects: true,\n    approval_required: true,\n    idempotent: false,\n    provider: 'Google Business Profile',\n    operation: 'accounts.locations.localPosts.create',\n    authentication_mode: 'OAUTH2',\n    required_scopes: [GOOGLE_BUSINESS_SCOPE],\n    permission_requirements: googleBusinessPermissionRequirements(\n      'accounts.locations.localPosts.create',\n      'PUBLISH',\n    ),\n    verification_method: 'PROVIDER_READBACK_AND_EXPECTED_STATE_COMPARISON',\n    rollback_method: 'EXPLICIT_PROVIDER_COMPENSATION_OR_MANUAL_RECOVERY',\n  },\n  'google_business.post.readback': {\n    description: 'Read a Google Business Local Post and compare it with the prepared expected state.',\n    risk_class: 'READ',\n    side_effects: false,\n    approval_required: false,\n    idempotent: true,\n    provider: 'Google Business Profile',\n    operation: 'accounts.locations.localPosts.get',\n    authentication_mode: 'OAUTH2',\n    required_scopes: [GOOGLE_BUSINESS_SCOPE],\n    permission_requirements: googleBusinessPermissionRequirements(\n      'accounts.locations.localPosts.get',\n      'READ',\n    ),\n    verification_method: 'PROVIDER_READBACK_AND_EXPECTED_STATE_COMPARISON',\n    rollback_method: 'NOT_APPLICABLE',\n  },\n  'google_business.review.ingest': {\n    description: 'Normalize an incoming Google Business review into an idempotent ingestion envelope.',\n    risk_class: 'READ',\n    side_effects: false,\n    approval_required: false,\n    idempotent: true,\n    provider: 'TOCA_OS+toca-mcp',\n    operation: 'google_business.review.ingest',\n    authentication_mode: 'INTERNAL',\n    required_scopes: [],\n    verification_method: 'NORMALIZED_REVIEW_SCHEMA_AND_DEDUPLICATION_KEY',\n    rollback_method: 'NOT_APPLICABLE',\n  },\n  'google_business.review.classify': {\n    description: 'Classify Google Business reviews conservatively for intent, sentiment and human-review risk.',\n    risk_class: 'READ',\n    side_effects: false,\n    approval_required: false,\n    idempotent: true,\n    provider: 'TOCA_OS+toca-mcp',\n    operation: 'google_business.review.classify',\n    authentication_mode: 'INTERNAL',\n    required_scopes: [],\n    verification_method: 'DETERMINISTIC_REVIEW_POLICY_CLASSIFICATION',\n    rollback_method: 'NOT_APPLICABLE',\n  },\n  'google_business.review.reply_draft': {\n    description: 'Create a review reply draft that is never eligible for unrestricted auto-reply.',\n    risk_class: 'READ',\n    side_effects: false,\n    approval_required: false,\n    idempotent: true,\n    provider: 'TOCA_OS+toca-mcp',\n    operation: 'google_business.review.reply_draft',\n    authentication_mode: 'INTERNAL',\n    required_scopes: [],\n    verification_method: 'REPLY_DRAFT_POLICY_VALIDATION',\n    rollback_method: 'NOT_APPLICABLE',\n  },\n  'google_business.review.reply': {\n    description: 'Publish a review reply only through R27 approval, with extra human review for complaints, legal and crisis cases, and provider read-back.',\n    risk_class: 'WRITE_EXTERNAL',\n    side_effects: true,\n    approval_required: true,\n    idempotent: false,\n    provider: 'Google Business Profile',\n    operation: 'accounts.locations.reviews.updateReply',\n    authentication_mode: 'OAUTH2',\n    required_scopes: [GOOGLE_BUSINESS_SCOPE],\n    permission_requirements: googleBusinessPermissionRequirements(\n      'accounts.locations.reviews.updateReply',\n      'COMMENT',\n    ),\n    verification_method: 'PROVIDER_READBACK_AND_EXPECTED_STATE_COMPARISON',\n    rollback_method: 'EXPLICIT_PROVIDER_COMPENSATION_OR_MANUAL_RECOVERY',\n  },\n  'google_business.review.verify': {\n    description: 'Read a Google Business review after reply and verify the exact provider-side reply text.',\n    risk_class: 'READ',\n    side_effects: false,\n    approval_required: false,\n    idempotent: true,\n    provider: 'Google Business Profile',\n    operation: 'accounts.locations.reviews.get',\n    authentication_mode: 'OAUTH2',\n    required_scopes: [GOOGLE_BUSINESS_SCOPE],\n    permission_requirements: googleBusinessPermissionRequirements(\n      'accounts.locations.reviews.get',\n      'READ',\n    ),\n    verification_method: 'PROVIDER_READBACK_AND_EXPECTED_STATE_COMPARISON',\n    rollback_method: 'NOT_APPLICABLE',\n  },\n  'google_business.notification.ingest': {\n    description: 'Normalize a verified Google Business Profile notification delivery into a stable deduplication envelope.',\n    risk_class: 'READ',\n    side_effects: false,\n    approval_required: false,\n    idempotent: true,\n    provider: 'Google Business Profile Notifications / Cloud PubSub',\n    operation: 'google_business.notification.ingest',\n    authentication_mode: 'INTERNAL',\n    required_scopes: [],\n    verification_method: 'NORMALIZED_NOTIFICATION_SCHEMA_AND_DEDUPLICATION_KEY',\n    rollback_method: 'NOT_APPLICABLE',\n  },\n  'google_business.performance.read': {\n    description: 'Read Google Business Profile Performance daily metrics for a bounded location/date range.',\n    risk_class: 'READ',\n    side_effects: false,\n    approval_required: false,\n    idempotent: true,\n    provider: 'Google Business Profile Performance API',\n    operation: 'locations.fetchMultiDailyMetricsTimeSeries',\n    authentication_mode: 'OAUTH2',\n    required_scopes: [GOOGLE_BUSINESS_SCOPE],\n    permission_requirements: googleBusinessPermissionRequirements(\n      'locations.fetchMultiDailyMetricsTimeSeries',\n      'READ',\n    ),\n    verification_method: 'PROVIDER_RESPONSE_SCHEMA_VALIDATION',\n    rollback_method: 'NOT_APPLICABLE',\n  },\n  'google_business.profile.drift.detect': {\n    description: 'Detect canonical-vs-provider and Google-updated profile drift without mutating the location.',\n    risk_class: 'READ',\n    side_effects: false,\n    approval_required: false,\n    idempotent: true,\n    provider: 'Google Business Profile',\n    operation: 'businessinformation.locations.get+getGoogleUpdated',\n    authentication_mode: 'OAUTH2',\n    required_scopes: [GOOGLE_BUSINESS_SCOPE],\n    permission_requirements: googleBusinessPermissionRequirements(\n      'businessinformation.locations.get+getGoogleUpdated',\n      'READ',\n    ),\n    verification_method: 'CANONICAL_PROVIDER_AND_GOOGLE_UPDATED_DIFF',\n    rollback_method: 'NOT_APPLICABLE',\n  },\n  'story.export': {\n    description: 'Export a Story artifact from an approved content definition.',\n`,
);

replaceOnce(
  'test/governance-catalog.test.ts',
  `  it('materializes the 731-capability catalog using contract v1.1 without pretending inference is explicit', () => {\n    expect(() => validateCapabilityCatalog()).not.toThrow();\n    expect(CAPABILITY_CATALOG).toHaveLength(731);\n`,
  `  it('materializes the 745-capability catalog using contract v1.1 without pretending inference is explicit', () => {\n    expect(() => validateCapabilityCatalog()).not.toThrow();\n    expect(CAPABILITY_CATALOG).toHaveLength(745);\n`,
);
replaceOnce(
  'test/governance-catalog.test.ts',
  `    expect(getRouteDefinition('R32').capabilityIds).toContain('registry.reconcile');\n`,
  `    expect(getRouteDefinition('R32').capabilityIds).toContain('registry.reconcile');\n    expect(getRouteDefinition('R07').subflows).toEqual(\n      expect.arrayContaining(['LOCAL_DISCOVERY', 'GOOGLE_EVENT_POST', 'PROFILE_FRESHNESS']),\n    );\n    expect(getRouteDefinition('R30').subflows).toContain('REVIEW_RESPONSE');\n    expect(getRouteDefinition('R31').subflows).toContain('LOCAL_PERFORMANCE');\n`,
);
replaceOnce(
  'test/governance-catalog.test.ts',
  `    expect(getCapabilityDefinition('release.deploy')).toMatchObject({\n      risk_class: 'WRITE_EXTERNAL',\n      approval_required: true,\n    });\n`,
  `    expect(getCapabilityDefinition('release.deploy')).toMatchObject({\n      risk_class: 'WRITE_EXTERNAL',\n      approval_required: true,\n    });\n    expect(getCapabilityDefinition('google_business.post.create')).toMatchObject({\n      route_id: 'R07',\n      lifecycle_status: 'IMPLEMENTED',\n      risk_class: 'WRITE_EXTERNAL',\n      side_effects: true,\n      approval_required: true,\n      execution_surface: 'INTERNAL_ENGINE',\n    });\n    expect(getCapabilityDefinition('google_business.review.reply')).toMatchObject({\n      route_id: 'R30',\n      lifecycle_status: 'IMPLEMENTED',\n      risk_class: 'WRITE_EXTERNAL',\n      approval_required: true,\n    });\n    expect(getCapabilityDefinition('google_business.performance.read')).toMatchObject({\n      route_id: 'R31',\n      lifecycle_status: 'IMPLEMENTED',\n      risk_class: 'READ',\n      side_effects: false,\n    });\n`,
);
replaceOnce(
  'test/governance-catalog.test.ts',
  `    expect(runtime.get('meta_ads.campaign.activate')).toBeUndefined();\n`,
  `    expect(runtime.get('meta_ads.campaign.activate')).toBeUndefined();\n    expect(runtime.get('google_business.post.create')).toBeUndefined();\n    expect(runtime.get('google_business.review.reply')).toBeUndefined();\n`,
);

replaceOnce(
  'test/capability-resolution.test.ts',
  `  it('preserves the 731 compatibility IDs while collapsing exact semantic aliases', () => {\n`,
  `  it('extends the catalog while preserving exact semantic compatibility aliases', () => {\n`,
);
replaceOnce(
  'test/capability-resolution.test.ts',
  `      raw_count: 731,\n      compatibility_alias_count: 8,\n      effective_count: 723,\n`,
  `      raw_count: 745,\n      compatibility_alias_count: 8,\n      effective_count: 737,\n`,
);

replaceOnce(
  'docs/architecture/routes-capabilities-v1.md',
  '`src/governance/capability-catalog.ts`: normalized metadata for all 731 catalog entries;',
  '`src/governance/capability-catalog.ts`: normalized metadata for all 745 catalog entries;',
);

console.log('Google Business local discovery / reputation patch applied.');

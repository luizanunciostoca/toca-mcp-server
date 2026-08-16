import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, value) {
  fs.writeFileSync(path, value);
}

function replaceOnce(value, before, after, label) {
  const index = value.indexOf(before);
  if (index < 0) throw new Error(`R29_HARDEN_ANCHOR_MISSING:${label}`);
  if (value.indexOf(before, index + before.length) >= 0) {
    throw new Error(`R29_HARDEN_ANCHOR_DUPLICATE:${label}`);
  }
  return value.slice(0, index) + after + value.slice(index + before.length);
}

{
  const path = 'src/content/runtime.ts';
  let value = read(path);
  value = replaceOnce(
    value,
    "import {\n  planContentRepurpose,\n",
    "import {\n  CONTENT_ITEM_FORMATS,\n  planContentRepurpose,\n",
    'runtime-format-import',
  );
  value = replaceOnce(
    value,
    "  type ContentItemStore,\n  type ContentItemVersion,\n",
    "  type ContentItemFormat,\n  type ContentItemStore,\n  type ContentItemVersion,\n",
    'runtime-format-type',
  );
  value = replaceOnce(
    value,
    `    if (capabilityId.startsWith('content_item.')) {\n      const item = await this.#contentStore.get(input.content_item_id);\n      const verified = item !== undefined;\n      return {\n        verified,\n        evidence: [verified ? \`r29:content:\${input.content_item_id}:readback\` : 'r29:content:missing'],\n        ...(verified\n          ? { externalResourceId: \`toca://r29/content/\${encodeURIComponent(input.content_item_id)}\` }\n          : { reason: 'R29_CONTENT_READBACK_MISSING' }),\n      };\n    }\n`,
    `    if (capabilityId.startsWith('content_item.')) {\n      const item = await this.#contentStore.get(input.content_item_id);\n      const contentRef = \`toca://r29/content/\${encodeURIComponent(input.content_item_id)}\`;\n      const record = asRecord(result);\n      let verified = false;\n      let externalResourceId = contentRef;\n\n      if (\n        capabilityId === 'content_item.version.create' ||\n        capabilityId === 'content_item.variant.create' ||\n        capabilityId === 'content_item.channel.adapt' ||\n        capabilityId === 'content_item.language.localize'\n      ) {\n        const resultVersionId =\n          typeof record.versionId === 'string' ? record.versionId.trim() : undefined;\n        const versions = await this.#contentStore.listVersions(input.content_item_id);\n        verified = Boolean(\n          item &&\n            resultVersionId &&\n            item.currentVersionId === resultVersionId &&\n            versions.some((version) => version.versionId === resultVersionId),\n        );\n        if (resultVersionId) {\n          externalResourceId = \`\${contentRef}/versions/\${encodeURIComponent(resultVersionId)}\`;\n        }\n      } else if (capabilityId === 'content_item.event.link') {\n        const targetEventId = optionalInputText(input.event_id ?? input.payload.event_id);\n        verified = Boolean(item && targetEventId && item.eventId === targetEventId);\n      } else if (capabilityId === 'content_item.experiment.link') {\n        const targetExperimentId = optionalInputText(\n          input.experiment_id ?? input.payload.experiment_id,\n        );\n        verified = Boolean(\n          item && targetExperimentId && item.experimentId === targetExperimentId,\n        );\n      }\n\n      return {\n        verified,\n        evidence: [\n          verified\n            ? \`r29:content:\${input.content_item_id}:\${capabilityId}:verified\`\n            : \`r29:content:\${input.content_item_id}:\${capabilityId}:mismatch\`,\n        ],\n        externalResourceId,\n        ...(!verified ? { reason: 'R29_CONTENT_READBACK_MISMATCH' } : {}),\n      };\n    }\n`,
    'runtime-readback',
  );
  value = replaceOnce(
    value,
    `    const variantKey = optionalPayloadText(input, 'variant_key');\n    return this.#contentStore.createVersion({\n`,
    `    const variantKey = optionalPayloadText(input, 'variant_key');\n    const channel =\n      derivationType === 'CHANNEL_ADAPTATION'\n        ? requireText(input.target_channel ?? '', 'R29_TARGET_CHANNEL_REQUIRED')\n        : input.target_channel;\n    const format =\n      derivationType === 'CHANNEL_ADAPTATION'\n        ? contentItemFormat(input.target_format)\n        : undefined;\n    const language =\n      derivationType === 'LOCALIZATION'\n        ? requireText(input.target_language ?? '', 'R29_TARGET_LANGUAGE_REQUIRED')\n        : input.target_language;\n    return this.#contentStore.createVersion({\n`,
    'runtime-derive-targets',
  );
  value = replaceOnce(
    value,
    `      ...(input.target_channel ? { channel: input.target_channel } : {}),\n      ...(input.target_language ? { language: input.target_language } : {}),\n`,
    `      ...(channel ? { channel } : {}),\n      ...(format ? { format } : {}),\n      ...(language ? { language } : {}),\n`,
    'runtime-derive-fields',
  );
  value = replaceOnce(
    value,
    `function normalizeEvidence(value: readonly string[]): readonly string[] {\n`,
    `function contentItemFormat(value: string | undefined): ContentItemFormat {\n  const normalized = requireText(value ?? '', 'R29_TARGET_FORMAT_REQUIRED');\n  if (!(CONTENT_ITEM_FORMATS as readonly string[]).includes(normalized)) {\n    throw new Error('R29_TARGET_FORMAT_INVALID');\n  }\n  return normalized as ContentItemFormat;\n}\n\nfunction optionalInputText(value: unknown): string | undefined {\n  if (value === undefined || value === null) return undefined;\n  if (typeof value !== 'string') return undefined;\n  const normalized = value.trim();\n  return normalized || undefined;\n}\n\nfunction normalizeEvidence(value: readonly string[]): readonly string[] {\n`,
    'runtime-helpers',
  );
  write(path, value);
}

{
  const path = 'src/mcp/runtime-capability-resolver.ts';
  let value = read(path);
  value = replaceOnce(
    value,
    `const videoContentInputSchema = z.object({\n  tenant_id: z.string().min(1),\n  workspace_id: z.string().min(1),\n  organization_id: z.string().min(1),\n  content_item_id: z.string().min(1),\n  version_id: z.string().min(1),\n  correlation_id: z.string().min(1),\n  idempotency_key: z.string().min(1).optional(),\n  evidence: z.array(z.string().min(1)).min(1),\n  payload: recordSchema,\n  approval_ref: z.string().min(1).optional(),\n  target_channel: z.string().min(1).optional(),\n  target_format: z.string().min(1).optional(),\n  target_language: z.string().min(1).optional(),\n  event_id: z.string().min(1).optional(),\n  experiment_id: z.string().min(1).optional(),\n});\n`,
    `const videoContentInputSchema = z.object({\n  tenant_id: z.string().min(1),\n  workspace_id: z.string().min(1),\n  organization_id: z.string().min(1),\n  content_item_id: z.string().min(1),\n  version_id: z.string().min(1),\n  correlation_id: z.string().min(1),\n  idempotency_key: z.string().min(1).optional(),\n  evidence: z.array(z.string().min(1)).min(1),\n  payload: recordSchema,\n  approval_ref: z.string().min(1).optional(),\n  target_channel: z.string().min(1).optional(),\n  target_format: z.string().min(1).optional(),\n  target_language: z.string().min(1).optional(),\n  event_id: z.string().min(1).optional(),\n  experiment_id: z.string().min(1).optional(),\n});\n\nfunction videoContentSchemaFor(capabilityId: string) {\n  switch (capabilityId) {\n    case 'video.export.reel':\n    case 'video.export.story':\n      return videoContentInputSchema.extend({ approval_ref: z.string().min(1) });\n    case 'content_item.channel.adapt':\n      return videoContentInputSchema.extend({\n        target_channel: z.string().min(1),\n        target_format: z.string().min(1),\n      });\n    case 'content_item.language.localize':\n      return videoContentInputSchema.extend({ target_language: z.string().min(1) });\n    case 'content_item.event.link':\n      return videoContentInputSchema.extend({ event_id: z.string().min(1) });\n    case 'content_item.experiment.link':\n      return videoContentInputSchema.extend({ experiment_id: z.string().min(1) });\n    default:\n      return videoContentInputSchema;\n  }\n}\n`,
    'resolver-schema-for-capability',
  );
  value = replaceOnce(
    value,
    `      videoContentInputSchema,\n      (input) => services.videoContent!.execute(capabilityId, input as VideoContentRuntimeInput),\n`,
    `      videoContentSchemaFor(capabilityId),\n      (input) => services.videoContent!.execute(capabilityId, input as VideoContentRuntimeInput),\n`,
    'resolver-schema-use',
  );
  write(path, value);
}

console.log('R29 runtime hardening applied');

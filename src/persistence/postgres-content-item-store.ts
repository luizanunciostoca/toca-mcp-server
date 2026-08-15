import type pg from 'pg';
import {
  assertContentItemStateTransition,
  assertJsonSerializable,
  assertPositiveInteger,
  normalizeStringSet,
  requireEvidence,
  requireText,
  validateContentItem,
  validateContentItemVersion,
  type ContentItem,
  type ContentItemStore,
  type ContentItemValidation,
  type ContentItemVersion,
  type ContentLinkInput,
  type CreateContentItemInput,
  type CreateContentItemVersionInput,
  type JsonValue,
  type RecordContentValidationInput,
  type TransitionContentItemInput,
} from '../content/content-item.js';
import { createDomainEvent } from '../events/domain-events.js';
import { PostgresTransactionalOutbox } from '../events/postgres-transactional-outbox.js';
import type { TransactionalOutboxWriter } from '../events/transactional-outbox.js';

interface ContentItemRow {
  readonly content_item_id: string;
  readonly content_key: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly assigned_route_id: 'R29';
  readonly product_ref: string | null;
  readonly slot_ref: string | null;
  readonly channel: string;
  readonly format: ContentItem['format'];
  readonly language: string;
  readonly state: ContentItem['state'];
  readonly current_content_version: number;
  readonly current_version_id: string;
  readonly event_id: string | null;
  readonly experiment_id: string | null;
  readonly record_version: number;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface ContentItemVersionRow {
  readonly version_id: string;
  readonly content_item_id: string;
  readonly version_number: number;
  readonly idempotency_key: string;
  readonly derivation_type: ContentItemVersion['derivationType'];
  readonly parent_version_id: string | null;
  readonly source_version_id: string | null;
  readonly lineage_root_version_id: string;
  readonly variant_key: string | null;
  readonly channel: string;
  readonly format: ContentItemVersion['format'];
  readonly language: string;
  readonly source_asset_ids: unknown;
  readonly derived_asset_ids: unknown;
  readonly payload: unknown;
  readonly source_refs: unknown;
  readonly evidence: unknown;
  readonly created_at: Date | string;
}

interface ContentItemValidationRow {
  readonly validation_id: string;
  readonly content_item_id: string;
  readonly version_id: string;
  readonly validation_type: ContentItemValidation['validationType'];
  readonly status: ContentItemValidation['status'];
  readonly issues: unknown;
  readonly evidence: unknown;
  readonly details: unknown;
  readonly created_at: Date | string;
}

interface EventScopeRow {
  readonly event_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
}

export interface PostgresContentItemStoreOptions {
  readonly outbox?: TransactionalOutboxWriter;
}

export class PostgresContentItemStore implements ContentItemStore {
  readonly #outbox: TransactionalOutboxWriter;

  constructor(
    private readonly pool: pg.Pool,
    options: PostgresContentItemStoreOptions = {},
  ) {
    this.#outbox = options.outbox ?? new PostgresTransactionalOutbox(pool);
  }

  async create(input: CreateContentItemInput): Promise<ContentItem> {
    const now = normalizeNow(input.now);
    const evidence = requireEvidence(input.evidence);
    const correlationId = requireText(input.correlationId, 'CONTENT_ITEM_CORRELATION_ID_REQUIRED');
    const contentItemId = requireText(input.contentItemId, 'CONTENT_ITEM_ID_REQUIRED');
    const contentKey = requireText(input.contentKey, 'CONTENT_ITEM_KEY_REQUIRED');
    const tenantId = requireText(input.tenantId, 'CONTENT_ITEM_TENANT_REQUIRED');
    const workspaceId = requireText(input.workspaceId, 'CONTENT_ITEM_WORKSPACE_REQUIRED');
    const organizationId = requireText(input.organizationId, 'CONTENT_ITEM_ORGANIZATION_REQUIRED');
    const assignedRouteId = input.assignedRouteId ?? 'R29';
    if (assignedRouteId !== 'R29') throw new Error('CONTENT_ITEM_R29_BACKBONE_REQUIRED');
    const sourceRefs = normalizeStringSet(input.sourceRefs, 'CONTENT_VERSION_SOURCE_REF_INVALID');
    if (sourceRefs.length === 0) throw new Error('CONTENT_VERSION_SOURCE_REF_REQUIRED');
    const sourceAssetIds = normalizeStringSet(
      input.sourceAssetIds ?? [],
      'CONTENT_VERSION_SOURCE_ASSET_INVALID',
    );
    const derivedAssetIds = normalizeStringSet(
      input.derivedAssetIds ?? [],
      'CONTENT_VERSION_DERIVED_ASSET_INVALID',
    );
    const idempotencyKey = requireText(
      input.idempotencyKey,
      'CONTENT_VERSION_IDEMPOTENCY_KEY_REQUIRED',
    );
    const initialVersionId = requireText(input.initialVersionId, 'CONTENT_VERSION_ID_REQUIRED');
    const payload = input.payload ?? {};
    assertJsonSerializable(payload, 'CONTENT_VERSION_PAYLOAD_INVALID');

    const item: ContentItem = {
      contentItemId,
      contentKey,
      tenantId,
      workspaceId,
      organizationId,
      assignedRouteId: 'R29',
      productRef: nullableText(input.productRef),
      slotRef: nullableText(input.slotRef),
      channel: requireText(input.channel, 'CONTENT_ITEM_CHANNEL_REQUIRED'),
      format: input.format,
      language: requireText(input.language, 'CONTENT_ITEM_LANGUAGE_REQUIRED'),
      state: 'PLANNED',
      currentContentVersion: 1,
      currentVersionId: initialVersionId,
      eventId: nullableText(input.eventId),
      experimentId: nullableText(input.experimentId),
      recordVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    validateContentItem(item);

    const version: ContentItemVersion = {
      versionId: initialVersionId,
      contentItemId,
      versionNumber: 1,
      idempotencyKey,
      derivationType: 'ORIGINAL',
      parentVersionId: null,
      sourceVersionId: null,
      lineageRootVersionId: initialVersionId,
      variantKey: null,
      channel: item.channel,
      format: item.format,
      language: item.language,
      sourceAssetIds,
      derivedAssetIds,
      payload,
      sourceRefs,
      evidence,
      createdAt: now,
    };
    validateContentItemVersion(version);

    const client = await this.pool.connect();
    try {
      await client.query('begin');
      if (item.eventId !== null) await assertEventScope(client, item, item.eventId);
      const inserted = await client.query<ContentItemRow>(
        `insert into content_items (
           content_item_id, content_key, tenant_id, workspace_id, organization_id,
           assigned_route_id, product_ref, slot_ref, channel, format, language, state,
           current_content_version, current_version_id, event_id, experiment_id,
           record_version, created_at, updated_at
         ) values (
           $1, $2, $3, $4, $5, 'R29', $6, $7, $8, $9, $10, 'PLANNED',
           1, $11, $12, $13, 1, $14::timestamptz, $14::timestamptz
         )
         on conflict (tenant_id, content_key) do nothing
         returning *`,
        [
          item.contentItemId,
          item.contentKey,
          item.tenantId,
          item.workspaceId,
          item.organizationId,
          item.productRef,
          item.slotRef,
          item.channel,
          item.format,
          item.language,
          item.currentVersionId,
          item.eventId,
          item.experimentId,
          now,
        ],
      );
      const insertedRow = inserted.rows[0];
      if (!insertedRow) {
        const existingResult = await client.query<ContentItemRow>(
          `select * from content_items where tenant_id = $1 and content_key = $2`,
          [item.tenantId, item.contentKey],
        );
        const existingRow = existingResult.rows[0];
        if (!existingRow) throw new Error('CONTENT_ITEM_IDEMPOTENCY_LOOKUP_FAILED');
        const existing = contentItemFromRow(existingRow);
        const rootResult = await client.query<ContentItemVersionRow>(
          `select * from content_item_versions where content_item_id = $1 and version_number = 1`,
          [existing.contentItemId],
        );
        const rootRow = rootResult.rows[0];
        if (!rootRow) throw new Error('CONTENT_ITEM_ROOT_VERSION_MISSING');
        const root = contentVersionFromRow(rootRow);
        if (!sameCreateIntent(existing, root, item, version)) {
          throw new Error('CONTENT_ITEM_IDEMPOTENCY_CONFLICT');
        }
        await client.query('commit');
        return existing;
      }

      await insertVersion(client, version);
      const created = contentItemFromRow(insertedRow);
      await this.#appendHistoryAndOutbox(client, {
        item: created,
        changeType: 'CREATED',
        eventType: 'content_item.created',
        eventKey: `${created.contentKey}:created`,
        payload: { item: created, version },
        correlationId,
        evidence,
        now,
      });
      await client.query('commit');
      return created;
    } catch (error) {
      await client.query('rollback');
      if (isUniqueViolation(error)) throw new Error('CONTENT_ITEM_ID_CONFLICT');
      throw error;
    } finally {
      client.release();
    }
  }

  async get(contentItemId: string): Promise<ContentItem | undefined> {
    const id = requireText(contentItemId, 'CONTENT_ITEM_ID_REQUIRED');
    const result = await this.pool.query<ContentItemRow>(
      'select * from content_items where content_item_id = $1',
      [id],
    );
    const row = result.rows[0];
    return row ? contentItemFromRow(row) : undefined;
  }

  async createVersion(input: CreateContentItemVersionInput): Promise<ContentItemVersion> {
    const now = normalizeNow(input.now);
    const evidence = requireEvidence(input.evidence);
    const correlationId = requireText(input.correlationId, 'CONTENT_ITEM_CORRELATION_ID_REQUIRED');
    const idempotencyKey = requireText(
      input.idempotencyKey,
      'CONTENT_VERSION_IDEMPOTENCY_KEY_REQUIRED',
    );
    assertPositiveInteger(input.expectedRecordVersion, 'CONTENT_ITEM_EXPECTED_VERSION_INVALID');

    return this.#withLockedItem(input.contentItemId, async (client, current) => {
      const existingResult = await client.query<ContentItemVersionRow>(
        `select * from content_item_versions where content_item_id = $1 and idempotency_key = $2`,
        [current.contentItemId, idempotencyKey],
      );
      const existingRow = existingResult.rows[0];
      if (existingRow) {
        const existing = contentVersionFromRow(existingRow);
        if (!sameVersionIntent(existing, input))
          throw new Error('CONTENT_VERSION_IDEMPOTENCY_CONFLICT');
        return existing;
      }

      assertExpectedVersion(current, input.expectedRecordVersion);
      const source = await getVersionForUpdate(
        client,
        current.contentItemId,
        input.sourceVersionId,
      );
      const parentVersionId =
        input.parentVersionId === undefined
          ? current.currentVersionId
          : nullableText(input.parentVersionId);
      if (parentVersionId !== null) {
        await getVersionForUpdate(client, current.contentItemId, parentVersionId);
      }
      const sourceAssetIds = normalizeStringSet(
        input.sourceAssetIds ?? source.sourceAssetIds,
        'CONTENT_VERSION_SOURCE_ASSET_INVALID',
      );
      const sourceRefs = normalizeStringSet(input.sourceRefs, 'CONTENT_VERSION_SOURCE_REF_INVALID');
      if (sourceRefs.length === 0) throw new Error('CONTENT_VERSION_SOURCE_REF_REQUIRED');
      const version: ContentItemVersion = {
        versionId: requireText(input.versionId, 'CONTENT_VERSION_ID_REQUIRED'),
        contentItemId: current.contentItemId,
        versionNumber: current.currentContentVersion + 1,
        idempotencyKey,
        derivationType: input.derivationType,
        parentVersionId,
        sourceVersionId: source.versionId,
        lineageRootVersionId: source.lineageRootVersionId,
        variantKey: nullableText(input.variantKey),
        channel:
          input.channel === undefined
            ? current.channel
            : requireText(input.channel, 'CONTENT_VERSION_CHANNEL_REQUIRED'),
        format: input.format ?? current.format,
        language:
          input.language === undefined
            ? current.language
            : requireText(input.language, 'CONTENT_VERSION_LANGUAGE_REQUIRED'),
        sourceAssetIds,
        derivedAssetIds: normalizeStringSet(
          input.derivedAssetIds ?? [],
          'CONTENT_VERSION_DERIVED_ASSET_INVALID',
        ),
        payload: input.payload,
        sourceRefs,
        evidence,
        createdAt: now,
      };
      validateContentItemVersion(version);
      await insertVersion(client, version);

      const updatedResult = await client.query<ContentItemRow>(
        `update content_items
         set current_content_version = $2,
             current_version_id = $3,
             channel = $4,
             format = $5,
             language = $6,
             record_version = record_version + 1,
             updated_at = $7::timestamptz
         where content_item_id = $1 and record_version = $8
         returning *`,
        [
          current.contentItemId,
          version.versionNumber,
          version.versionId,
          version.channel,
          version.format,
          version.language,
          now,
          current.recordVersion,
        ],
      );
      const updatedRow = updatedResult.rows[0];
      if (!updatedRow) throw new Error('CONTENT_ITEM_CONCURRENT_UPDATE');
      const updated = contentItemFromRow(updatedRow);
      await this.#appendHistoryAndOutbox(client, {
        item: updated,
        changeType: 'VERSION_CREATED',
        eventType: 'content_item.version_created',
        eventKey: `${updated.contentKey}:version:${version.versionId}`,
        payload: { item: updated, version },
        correlationId,
        evidence,
        now,
      });
      return version;
    });
  }

  async listVersions(contentItemId: string): Promise<readonly ContentItemVersion[]> {
    const id = requireText(contentItemId, 'CONTENT_ITEM_ID_REQUIRED');
    const result = await this.pool.query<ContentItemVersionRow>(
      `select * from content_item_versions where content_item_id = $1 order by version_number asc`,
      [id],
    );
    return result.rows.map(contentVersionFromRow);
  }

  async transitionState(input: TransitionContentItemInput): Promise<ContentItem> {
    const now = normalizeNow(input.now);
    const evidence = requireEvidence(input.evidence);
    const correlationId = requireText(input.correlationId, 'CONTENT_ITEM_CORRELATION_ID_REQUIRED');
    assertPositiveInteger(input.expectedRecordVersion, 'CONTENT_ITEM_EXPECTED_VERSION_INVALID');

    return this.#withLockedItem(input.contentItemId, async (client, current) => {
      assertExpectedVersion(current, input.expectedRecordVersion);
      assertContentItemStateTransition(current.state, input.state);
      if (current.state === input.state) return current;
      const updatedResult = await client.query<ContentItemRow>(
        `update content_items
         set state = $2, record_version = record_version + 1, updated_at = $3::timestamptz
         where content_item_id = $1 and record_version = $4
         returning *`,
        [current.contentItemId, input.state, now, current.recordVersion],
      );
      const updatedRow = updatedResult.rows[0];
      if (!updatedRow) throw new Error('CONTENT_ITEM_CONCURRENT_UPDATE');
      const updated = contentItemFromRow(updatedRow);
      await this.#appendHistoryAndOutbox(client, {
        item: updated,
        changeType: 'STATE_CHANGED',
        eventType: 'content_item.state_changed',
        eventKey: `${updated.contentKey}:state:${updated.recordVersion}`,
        payload: { previousState: current.state, currentState: updated.state },
        correlationId,
        evidence,
        now,
      });
      return updated;
    });
  }

  async linkEvent(input: ContentLinkInput): Promise<ContentItem> {
    return this.#link(input, 'EVENT');
  }

  async linkExperiment(input: ContentLinkInput): Promise<ContentItem> {
    return this.#link(input, 'EXPERIMENT');
  }

  async recordValidation(input: RecordContentValidationInput): Promise<ContentItemValidation> {
    const now = normalizeNow(input.now);
    const evidence = requireEvidence(input.evidence);
    const correlationId = requireText(input.correlationId, 'CONTENT_ITEM_CORRELATION_ID_REQUIRED');
    const validationId = requireText(input.validationId, 'CONTENT_VALIDATION_ID_REQUIRED');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const itemResult = await client.query<ContentItemRow>(
        'select * from content_items where content_item_id = $1 for update',
        [requireText(input.contentItemId, 'CONTENT_ITEM_ID_REQUIRED')],
      );
      const itemRow = itemResult.rows[0];
      if (!itemRow) throw new Error('CONTENT_ITEM_NOT_FOUND');
      const item = contentItemFromRow(itemRow);
      await getVersionForUpdate(client, item.contentItemId, input.versionId);
      const issues = normalizeStringSet(input.issues ?? [], 'CONTENT_VALIDATION_ISSUE_INVALID');
      const details = input.details ?? {};
      assertJsonSerializable(details, 'CONTENT_VALIDATION_DETAILS_INVALID');
      const inserted = await client.query<ContentItemValidationRow>(
        `insert into content_item_validations (
           validation_id, content_item_id, version_id, validation_type, status,
           issues, evidence, details, correlation_id, created_at
         ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10::timestamptz)
         on conflict (validation_id) do nothing
         returning *`,
        [
          validationId,
          item.contentItemId,
          input.versionId,
          input.validationType,
          input.status,
          json(issues),
          json(evidence),
          json(details),
          correlationId,
          now,
        ],
      );
      let validation: ContentItemValidation;
      const insertedRow = inserted.rows[0];
      if (insertedRow) {
        validation = contentValidationFromRow(insertedRow);
      } else {
        const existingResult = await client.query<ContentItemValidationRow>(
          'select * from content_item_validations where validation_id = $1',
          [validationId],
        );
        const existingRow = existingResult.rows[0];
        if (!existingRow) throw new Error('CONTENT_VALIDATION_IDEMPOTENCY_LOOKUP_FAILED');
        validation = contentValidationFromRow(existingRow);
        if (
          validation.contentItemId !== item.contentItemId ||
          validation.versionId !== input.versionId ||
          validation.validationType !== input.validationType ||
          validation.status !== input.status ||
          canonical(validation.issues) !== canonical(issues) ||
          canonical(validation.details) !== canonical(details)
        ) {
          throw new Error('CONTENT_VALIDATION_IDEMPOTENCY_CONFLICT');
        }
      }
      await this.#outbox.enqueue(
        client,
        createDomainEvent({
          tenantId: item.tenantId,
          workspaceId: item.workspaceId,
          organizationId: item.organizationId,
          eventKey: `${item.contentKey}:validation:${validation.validationId}`,
          eventType: 'content_item.validation_recorded',
          aggregateType: 'content_item',
          aggregateId: item.contentItemId,
          aggregateVersion: item.recordVersion,
          correlationId,
          occurredAt: now,
          payload: validation,
          evidence,
        }),
      );
      await client.query('commit');
      return validation;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async #link(input: ContentLinkInput, kind: 'EVENT' | 'EXPERIMENT'): Promise<ContentItem> {
    const now = normalizeNow(input.now);
    const evidence = requireEvidence(input.evidence);
    const correlationId = requireText(input.correlationId, 'CONTENT_ITEM_CORRELATION_ID_REQUIRED');
    const targetId = requireText(input.targetId, `CONTENT_ITEM_${kind}_ID_REQUIRED`);
    assertPositiveInteger(input.expectedRecordVersion, 'CONTENT_ITEM_EXPECTED_VERSION_INVALID');

    return this.#withLockedItem(input.contentItemId, async (client, current) => {
      assertExpectedVersion(current, input.expectedRecordVersion);
      const existing = kind === 'EVENT' ? current.eventId : current.experimentId;
      if (existing === targetId) return current;
      if (existing !== null) throw new Error(`CONTENT_ITEM_${kind}_LINK_CONFLICT`);
      if (kind === 'EVENT') await assertEventScope(client, current, targetId);
      const column = kind === 'EVENT' ? 'event_id' : 'experiment_id';
      const updatedResult = await client.query<ContentItemRow>(
        `update content_items
         set ${column} = $2, record_version = record_version + 1, updated_at = $3::timestamptz
         where content_item_id = $1 and record_version = $4
         returning *`,
        [current.contentItemId, targetId, now, current.recordVersion],
      );
      const updatedRow = updatedResult.rows[0];
      if (!updatedRow) throw new Error('CONTENT_ITEM_CONCURRENT_UPDATE');
      const updated = contentItemFromRow(updatedRow);
      await this.#appendHistoryAndOutbox(client, {
        item: updated,
        changeType: kind === 'EVENT' ? 'EVENT_LINKED' : 'EXPERIMENT_LINKED',
        eventType:
          kind === 'EVENT' ? 'content_item.event_linked' : 'content_item.experiment_linked',
        eventKey: `${updated.contentKey}:${kind.toLowerCase()}:${targetId}`,
        payload: { targetId },
        correlationId,
        evidence,
        now,
      });
      return updated;
    });
  }

  async #withLockedItem<T>(
    contentItemId: string,
    action: (client: pg.PoolClient, current: ContentItem) => Promise<T>,
  ): Promise<T> {
    const id = requireText(contentItemId, 'CONTENT_ITEM_ID_REQUIRED');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query<ContentItemRow>(
        'select * from content_items where content_item_id = $1 for update',
        [id],
      );
      const row = result.rows[0];
      if (!row) throw new Error('CONTENT_ITEM_NOT_FOUND');
      const output = await action(client, contentItemFromRow(row));
      await client.query('commit');
      return output;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async #appendHistoryAndOutbox(
    client: pg.PoolClient,
    input: {
      readonly item: ContentItem;
      readonly changeType:
        'CREATED' | 'VERSION_CREATED' | 'STATE_CHANGED' | 'EVENT_LINKED' | 'EXPERIMENT_LINKED';
      readonly eventType: string;
      readonly eventKey: string;
      readonly payload: JsonValue | { readonly [key: string]: unknown };
      readonly correlationId: string;
      readonly evidence: readonly string[];
      readonly now: string;
    },
  ): Promise<void> {
    await client.query(
      `insert into content_item_history (
         content_item_id, record_version, change_type, snapshot, evidence, correlation_id, created_at
       ) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::timestamptz)`,
      [
        input.item.contentItemId,
        input.item.recordVersion,
        input.changeType,
        json(input.item),
        json(input.evidence),
        input.correlationId,
        input.now,
      ],
    );
    await this.#outbox.enqueue(
      client,
      createDomainEvent({
        tenantId: input.item.tenantId,
        workspaceId: input.item.workspaceId,
        organizationId: input.item.organizationId,
        eventKey: input.eventKey,
        eventType: input.eventType,
        aggregateType: 'content_item',
        aggregateId: input.item.contentItemId,
        aggregateVersion: input.item.recordVersion,
        correlationId: input.correlationId,
        occurredAt: input.now,
        payload: input.payload,
        evidence: input.evidence,
      }),
    );
  }
}

async function insertVersion(client: pg.PoolClient, version: ContentItemVersion): Promise<void> {
  await client.query(
    `insert into content_item_versions (
       version_id, content_item_id, version_number, idempotency_key, derivation_type,
       parent_version_id, source_version_id, lineage_root_version_id, variant_key,
       channel, format, language, source_asset_ids, derived_asset_ids, payload,
       source_refs, evidence, created_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
       $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb, $18::timestamptz
     )`,
    [
      version.versionId,
      version.contentItemId,
      version.versionNumber,
      version.idempotencyKey,
      version.derivationType,
      version.parentVersionId,
      version.sourceVersionId,
      version.lineageRootVersionId,
      version.variantKey,
      version.channel,
      version.format,
      version.language,
      json(version.sourceAssetIds),
      json(version.derivedAssetIds),
      json(version.payload),
      json(version.sourceRefs),
      json(version.evidence),
      version.createdAt,
    ],
  );
}

async function getVersionForUpdate(
  client: pg.PoolClient,
  contentItemId: string,
  versionId: string,
): Promise<ContentItemVersion> {
  const id = requireText(versionId, 'CONTENT_VERSION_ID_REQUIRED');
  const result = await client.query<ContentItemVersionRow>(
    `select * from content_item_versions
     where content_item_id = $1 and version_id = $2
     for share`,
    [contentItemId, id],
  );
  const row = result.rows[0];
  if (!row) throw new Error('CONTENT_VERSION_NOT_FOUND');
  return contentVersionFromRow(row);
}

async function assertEventScope(
  client: pg.PoolClient,
  item: Pick<ContentItem, 'tenantId' | 'workspaceId' | 'organizationId'>,
  eventId: string,
): Promise<void> {
  const result = await client.query<EventScopeRow>(
    `select event_id, tenant_id, workspace_id, organization_id
     from event_records where event_id = $1`,
    [eventId],
  );
  const event = result.rows[0];
  if (!event) throw new Error('CONTENT_ITEM_EVENT_NOT_FOUND');
  if (
    event.tenant_id !== item.tenantId ||
    event.workspace_id !== item.workspaceId ||
    event.organization_id !== item.organizationId
  ) {
    throw new Error('CONTENT_ITEM_EVENT_SCOPE_MISMATCH');
  }
}

function contentItemFromRow(row: ContentItemRow): ContentItem {
  const item: ContentItem = {
    contentItemId: row.content_item_id,
    contentKey: row.content_key,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    assignedRouteId: row.assigned_route_id,
    productRef: row.product_ref,
    slotRef: row.slot_ref,
    channel: row.channel,
    format: row.format,
    language: row.language,
    state: row.state,
    currentContentVersion: row.current_content_version,
    currentVersionId: row.current_version_id,
    eventId: row.event_id,
    experimentId: row.experiment_id,
    recordVersion: row.record_version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  validateContentItem(item);
  return item;
}

function contentVersionFromRow(row: ContentItemVersionRow): ContentItemVersion {
  const version: ContentItemVersion = {
    versionId: row.version_id,
    contentItemId: row.content_item_id,
    versionNumber: row.version_number,
    idempotencyKey: row.idempotency_key,
    derivationType: row.derivation_type,
    parentVersionId: row.parent_version_id,
    sourceVersionId: row.source_version_id,
    lineageRootVersionId: row.lineage_root_version_id,
    variantKey: row.variant_key,
    channel: row.channel,
    format: row.format,
    language: row.language,
    sourceAssetIds: decodeStringArray(row.source_asset_ids, 'CONTENT_VERSION_SOURCE_ASSET_INVALID'),
    derivedAssetIds: decodeStringArray(
      row.derived_asset_ids,
      'CONTENT_VERSION_DERIVED_ASSET_INVALID',
    ),
    payload: decodeJsonValue(row.payload, 'CONTENT_VERSION_PAYLOAD_INVALID'),
    sourceRefs: decodeStringArray(row.source_refs, 'CONTENT_VERSION_SOURCE_REF_INVALID'),
    evidence: requireEvidence(decodeStringArray(row.evidence, 'CONTENT_EVIDENCE_INVALID')),
    createdAt: iso(row.created_at),
  };
  validateContentItemVersion(version);
  return version;
}

function contentValidationFromRow(row: ContentItemValidationRow): ContentItemValidation {
  return {
    validationId: row.validation_id,
    contentItemId: row.content_item_id,
    versionId: row.version_id,
    validationType: row.validation_type,
    status: row.status,
    issues: decodeStringArray(row.issues, 'CONTENT_VALIDATION_ISSUE_INVALID'),
    evidence: requireEvidence(decodeStringArray(row.evidence, 'CONTENT_EVIDENCE_INVALID')),
    details: decodeJsonValue(row.details, 'CONTENT_VALIDATION_DETAILS_INVALID'),
    createdAt: iso(row.created_at),
  };
}

function sameCreateIntent(
  existing: ContentItem,
  existingRoot: ContentItemVersion,
  expected: ContentItem,
  expectedRoot: ContentItemVersion,
): boolean {
  return (
    existing.contentItemId === expected.contentItemId &&
    existing.tenantId === expected.tenantId &&
    existing.workspaceId === expected.workspaceId &&
    existing.organizationId === expected.organizationId &&
    existing.productRef === expected.productRef &&
    existing.slotRef === expected.slotRef &&
    existingRoot.versionId === expectedRoot.versionId &&
    existingRoot.channel === expectedRoot.channel &&
    existingRoot.format === expectedRoot.format &&
    existingRoot.language === expectedRoot.language &&
    existingRoot.idempotencyKey === expectedRoot.idempotencyKey &&
    canonical(existingRoot.sourceAssetIds) === canonical(expectedRoot.sourceAssetIds) &&
    canonical(existingRoot.derivedAssetIds) === canonical(expectedRoot.derivedAssetIds) &&
    canonical(existingRoot.payload) === canonical(expectedRoot.payload) &&
    canonical(existingRoot.sourceRefs) === canonical(expectedRoot.sourceRefs)
  );
}

function sameVersionIntent(
  existing: ContentItemVersion,
  input: CreateContentItemVersionInput,
): boolean {
  const requestedSourceAssets =
    input.sourceAssetIds === undefined
      ? undefined
      : normalizeStringSet(input.sourceAssetIds, 'CONTENT_VERSION_SOURCE_ASSET_INVALID');
  const requestedDerivedAssets = normalizeStringSet(
    input.derivedAssetIds ?? [],
    'CONTENT_VERSION_DERIVED_ASSET_INVALID',
  );
  return (
    existing.versionId === input.versionId &&
    existing.derivationType === input.derivationType &&
    existing.sourceVersionId === input.sourceVersionId &&
    (input.parentVersionId === undefined ||
      existing.parentVersionId === nullableText(input.parentVersionId)) &&
    existing.variantKey === nullableText(input.variantKey) &&
    (input.channel === undefined ||
      existing.channel === requireText(input.channel, 'CONTENT_VERSION_CHANNEL_REQUIRED')) &&
    (input.format === undefined || existing.format === input.format) &&
    (input.language === undefined ||
      existing.language === requireText(input.language, 'CONTENT_VERSION_LANGUAGE_REQUIRED')) &&
    (requestedSourceAssets === undefined ||
      canonical(existing.sourceAssetIds) === canonical(requestedSourceAssets)) &&
    canonical(existing.derivedAssetIds) === canonical(requestedDerivedAssets) &&
    canonical(existing.payload) === canonical(input.payload) &&
    canonical(existing.sourceRefs) ===
      canonical(normalizeStringSet(input.sourceRefs, 'CONTENT_VERSION_SOURCE_REF_INVALID'))
  );
}

function assertExpectedVersion(item: ContentItem, expected: number): void {
  if (item.recordVersion !== expected) throw new Error('CONTENT_ITEM_VERSION_CONFLICT');
}

function normalizeNow(value: string | undefined): string {
  const date = value === undefined ? new Date() : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('CONTENT_ITEM_NOW_INVALID');
  return date.toISOString();
}

function nullableText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return requireText(value, 'CONTENT_ITEM_OPTIONAL_TEXT_INVALID');
}

function decodeStringArray(value: unknown, errorCode: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new Error(errorCode);
  return normalizeStringSet(value as string[], errorCode);
}

function decodeJsonValue(value: unknown, errorCode: string): JsonValue {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('undefined');
    return JSON.parse(serialized) as JsonValue;
  } catch {
    throw new Error(errorCode);
  }
}

function canonical(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('CONTENT_ITEM_PERSISTED_TIMESTAMP_INVALID');
  return date.toISOString();
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

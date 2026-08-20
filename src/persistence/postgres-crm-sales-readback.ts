import type pg from 'pg';
import type { CrmScope } from '../crm/crm-records.js';
import { validateCrmScope } from '../crm/crm-records.js';

export interface CrmSalesPersistenceReadback {
  activityExists(input: CrmScope & { readonly activityId: string }): Promise<boolean>;
}

export class PostgresCrmSalesPersistenceReadback implements CrmSalesPersistenceReadback {
  constructor(private readonly pool: pg.Pool) {}

  async activityExists(input: CrmScope & { readonly activityId: string }): Promise<boolean> {
    validateCrmScope(input);
    const activityId = input.activityId.trim();
    if (!activityId) throw new Error('CRM_ACTIVITY_ID_REQUIRED');
    const result = await this.pool.query(
      `select 1
         from crm_sales_activities
        where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and activity_id=$4`,
      [input.tenantId, input.workspaceId, input.organizationId, activityId],
    );
    return result.rowCount === 1;
  }
}

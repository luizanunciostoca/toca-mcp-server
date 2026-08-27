export function resolveTocaManagedInstagramTenantId(env: NodeJS.ProcessEnv = process.env): string {
  return env.TOCA_DEFAULT_TENANT_ID?.trim() || 'toca';
}

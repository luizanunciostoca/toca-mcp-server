-- Exclusive ownership guards for resources that must never be shared across tenants.
-- Generic policy/template reuse should happen through canonical template references, not
-- by binding the same executable resource/account/secret namespace to multiple tenants.

create unique index if not exists tenant_configurations_brand_owner_uq
  on tenant_configurations (brand_resource_id);
create unique index if not exists tenant_configurations_creative_truth_owner_uq
  on tenant_configurations (creative_truth_registry_resource_id);
create unique index if not exists tenant_configurations_asset_registry_owner_uq
  on tenant_configurations (asset_registry_resource_id);
create unique index if not exists tenant_configurations_analytics_owner_uq
  on tenant_configurations (analytics_namespace);

create unique index if not exists tenant_provider_bindings_account_owner_uq
  on tenant_provider_bindings (provider_id, connected_account_id);
create unique index if not exists tenant_credential_bindings_secret_owner_uq
  on tenant_credential_bindings (secret_provider, secret_key_reference);
create unique index if not exists tenant_policy_bindings_resource_owner_uq
  on tenant_policy_bindings (policy_resource_id);
create unique index if not exists tenant_approval_chain_bindings_resource_owner_uq
  on tenant_approval_chain_bindings (approval_resource_id);
create unique index if not exists tenant_asset_registry_bindings_resource_owner_uq
  on tenant_asset_registry_bindings (asset_registry_resource_id);
create unique index if not exists tenant_analytics_namespaces_owner_uq
  on tenant_analytics_namespaces (analytics_namespace);

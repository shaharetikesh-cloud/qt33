-- QT33 Phase-1 sync/realtime hardening
-- Non-destructive migration: only indexes + realtime publication membership.
-- Baseline expectation: rls_substation_access_hardening_2026_04_24.sql is already applied.

begin;

-- Performance indexes for scoped sync fetch and admin diagnostics.
create index if not exists idx_erp_records_scope_substation_updated
  on public.erp_records(scope, substation_id, updated_at desc);

create index if not exists idx_erp_records_scope_updated_not_deleted
  on public.erp_records(scope, updated_at desc)
  where deleted = false;

create index if not exists idx_erp_records_updated_by_updated_at
  on public.erp_records(updated_by, updated_at desc);

create index if not exists idx_erp_records_device_updated_at
  on public.erp_records(device_id, updated_at desc);

create index if not exists idx_dlr_records_substation_module_date
  on public.dlr_records(substation_id, module_name, operational_date desc);

create index if not exists idx_dlr_records_owner_updated_at
  on public.dlr_records(owner_auth_user_id, updated_at desc);

-- Realtime publication: ensure required tables are included.
do $$
begin
  begin
    alter publication supabase_realtime add table public.erp_records;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.dlr_records;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;

-- Deterministic lookup index for conflict checks on logical keys.
create index if not exists idx_dlr_records_scope_guard
  on public.dlr_records(module_name, substation_id, operational_date, record_key);

commit;

-- NOTE:
-- Keep permissive compatibility scripts deprecated in deployment order.
-- Canonical policy baseline remains:
--   rls_substation_access_hardening_2026_04_24.sql


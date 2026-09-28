-- =============================================================================
-- Staff / super admin membership via app_metadata, applied on UPDATE too.
--
-- GoTrue's admin createUser() INSERTs the auth user first (app_metadata only
-- has {provider, providers}) and writes the custom app_metadata in a
-- follow-up UPDATE. At INSERT time the user therefore looks like a
-- self-signup and gets a fresh tenant. When the membership arrives we move
-- the user into the intended tenant / role and drop the empty tenant that was
-- auto-created for them.
-- =============================================================================

create or replace function public.handle_auth_user_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_meta    jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  new_role    text  := app_meta ->> 'role';
  new_tenant  uuid;
  old_tenant  uuid;
begin
  if new_role is null or new_role not in ('staff', 'owner', 'super_admin') then
    return new;
  end if;
  if new_role in ('staff', 'owner') then
    if not (app_meta ? 'tenant_id') then
      return new;
    end if;
    new_tenant := (app_meta ->> 'tenant_id')::uuid;
  end if;

  select u.tenant_id into old_tenant from public.users u where u.id = new.id;
  if not found then
    return new;
  end if;

  update public.users
     set tenant_id = new_tenant,
         role = new_role::public.user_role
   where id = new.id
     and (tenant_id is distinct from new_tenant or role is distinct from new_role::public.user_role);

  -- Remove the tenant that was auto-created for this user at INSERT time, but
  -- only if nobody else belongs to it and it holds no data.
  if old_tenant is not null and old_tenant is distinct from new_tenant
     and not exists (select 1 from public.users where tenant_id = old_tenant)
     and not exists (select 1 from public.products where tenant_id = old_tenant)
     and not exists (select 1 from public.customers where tenant_id = old_tenant)
     and not exists (select 1 from public.subscriptions where tenant_id = old_tenant) then
    delete from public.tenants where id = old_tenant;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_membership
  after update of raw_app_meta_data on auth.users
  for each row
  when (old.raw_app_meta_data is distinct from new.raw_app_meta_data)
  execute function public.handle_auth_user_membership();

revoke all on function public.handle_auth_user_membership() from public, anon, authenticated;

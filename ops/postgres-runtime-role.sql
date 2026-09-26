-- Run as the same administrator role that owns public schema migrations.
-- Set the runtime role's LOGIN password separately with psql \password.
-- Set DATABASE_SCHEMA_MODE=verify for web/worker after running database:migrate
-- with the administrator URL; never give this role archive-schema access.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'mah_app_runtime') then
    create role mah_app_runtime nologin;
  end if;
end
$$;

do $$
begin
  execute format('grant connect on database %I to mah_app_runtime', current_database());
end
$$;
grant usage on schema public to mah_app_runtime;
grant select, insert, update, delete on all tables in schema public to mah_app_runtime;
grant usage, select on all sequences in schema public to mah_app_runtime;
alter default privileges in schema public
  grant select, insert, update, delete on tables to mah_app_runtime;
alter default privileges in schema public
  grant usage, select on sequences to mah_app_runtime;

do $$
begin
  if (select rolsuper or rolcreaterole or rolcreatedb
        from pg_roles where rolname = 'mah_app_runtime') then
    raise exception 'Application runtime role has administrative privileges';
  end if;
  if exists (
    select 1 from pg_roles
     where rolname in ('mah_legacy_archive_owner', 'mah_legacy_archive_importer')
       and pg_has_role('mah_app_runtime', oid, 'member')
  ) then
    raise exception 'Application runtime role inherits a legacy archive role';
  end if;
end
$$;

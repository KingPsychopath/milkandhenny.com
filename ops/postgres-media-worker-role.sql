-- Run after database:migrate as the schema owner. Create a separate LOGIN role,
-- grant it mah_media_worker, and set its password outside this file.
-- The worker must use DATABASE_SCHEMA_MODE=verify.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'mah_media_worker') then
    create role mah_media_worker nologin;
  end if;
end
$$;

do $$
begin
  execute format('grant connect on database %I to mah_media_worker', current_database());
end
$$;
grant usage on schema public to mah_media_worker;
grant select on schema_migrations to mah_media_worker;
grant select on gallery_albums to mah_media_worker;
grant select on gallery_album_photos to mah_media_worker;

grant select, update on transfers, transfer_files to mah_media_worker;
grant select on transfer_groups, transfer_group_members,
  transfer_upload_reservations, transfer_append_reservations to mah_media_worker;
grant select, insert, update on transfer_media_jobs,
  transfer_media_job_attempt_outputs, media_worker_instances,
  media_object_operations to mah_media_worker;

do $$
begin
  if (select rolsuper or rolcreaterole or rolcreatedb or rolbypassrls
        from pg_roles where rolname = 'mah_media_worker') then
    raise exception 'Media worker role has administrative privileges';
  end if;
  if has_schema_privilege('mah_media_worker', 'public', 'CREATE') then
    raise exception 'Media worker role can create in public schema';
  end if;
  if exists (
    select 1 from pg_roles
     where rolname in ('mah_app_runtime', 'mah_legacy_archive_owner', 'mah_legacy_archive_importer')
       and pg_has_role('mah_media_worker', oid, 'member')
  ) then
    raise exception 'Media worker role inherits a broader application or archive role';
  end if;
  if has_table_privilege('mah_media_worker', 'auth_token_sessions', 'SELECT') or
     has_table_privilege('mah_media_worker', 'checkout_sessions', 'SELECT') or
     has_table_privilege('mah_media_worker', 'tickets', 'SELECT') then
    raise exception 'Media worker role can read credential or finance tables';
  end if;
end
$$;

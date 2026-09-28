-- Run as a database administrator with psql before importing historical guest data.
-- The application role must not own or inherit either archive role. Provision the
-- mah_legacy_archive_importer LOGIN credential separately and supply its URL only
-- to the offline importer, never to the web or worker runtime.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'mah_legacy_archive_owner') then
    create role mah_legacy_archive_owner nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'mah_legacy_archive_importer') then
    create role mah_legacy_archive_importer nologin;
  end if;
end
$$;

create schema if not exists legacy_archive authorization mah_legacy_archive_owner;
alter schema legacy_archive owner to mah_legacy_archive_owner;
revoke all on schema legacy_archive from public;
grant usage on schema legacy_archive to mah_legacy_archive_importer;

create table if not exists legacy_archive.guest_list_exports (
  source_rdb_sha256 text primary key
    check (source_rdb_sha256 ~ '^[a-f0-9]{64}$'),
  source_key text not null default 'guest:list'
    check (source_key = 'guest:list'),
  payload_sha256 text not null
    check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  guest_count integer not null check (guest_count >= 0),
  plus_one_count integer not null check (plus_one_count >= 0),
  encryption_version integer not null default 1
    check (encryption_version = 1),
  nonce bytea not null check (octet_length(nonce) = 12),
  auth_tag bytea not null check (octet_length(auth_tag) = 16),
  ciphertext bytea not null check (octet_length(ciphertext) > 0),
  imported_at timestamptz not null default now()
);
alter table legacy_archive.guest_list_exports owner to mah_legacy_archive_owner;
revoke all on legacy_archive.guest_list_exports from public;
grant select, insert on legacy_archive.guest_list_exports to mah_legacy_archive_importer;

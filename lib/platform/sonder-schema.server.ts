/** Append-only migration 0123. Do not edit after deployment. */
export const SONDER_SCHEMA = `
create table sonder_event_links (
  event_slug text primary key references events(slug) on update cascade on delete restrict,
  hangout_id uuid not null,
  mode text not null check (mode in ('live','test')),
  booking_url text not null,
  cancelled_at timestamptz,
  dirty_revision bigint not null default 0,
  synced_revision bigint not null default -1,
  last_sync_at timestamptz,
  last_webhook_at timestamptz,
  next_sync_at timestamptz not null default now(),
  last_error text,
  paused boolean not null default false,
  sync_token uuid,
  sync_until timestamptz,
  created_at timestamptz not null default now(),
  unique(mode,hangout_id)
);
create table sonder_webhook_events (
  mode text not null check (mode in ('live','test')),
  id uuid not null,
  type text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  primary key(mode,id)
);
create table sonder_orders (
  event_slug text not null references sonder_event_links(event_slug) on update cascade on delete restrict,
  id uuid not null,
  snapshot jsonb not null,
  team_id text references score_teams(id) on delete restrict,
  revision bigint not null default 1,
  snapshot_hash text not null,
  last_email_hash text,
  email_revision bigint not null default 0,
  seen_in_sync uuid not null,
  missing boolean not null default false,
  conflict boolean not null default false,
  primary key(event_slug,id)
);
create table sonder_tickets (
  event_slug text not null,
  id uuid not null,
  order_id uuid not null,
  ordinal integer not null check (ordinal > 0),
  status text not null check(status in ('valid','checked_in','inactive')),
  checked_in_at timestamptz,
  participant_id text not null unique references event_participants(id) on delete restrict,
  primary key(event_slug,id),
  foreign key(event_slug,order_id) references sonder_orders(event_slug,id) on update cascade on delete restrict
);
create index sonder_ticket_orders_idx on sonder_tickets(event_slug,order_id);
create table sonder_email_guards (
  content_hash text not null,
  team_id text not null,
  team_name text not null,
  team_colour text not null,
  event_updated_at timestamptz not null,
  outbox_id uuid primary key references email_outbox(id) on delete cascade,
  event_slug text not null,
  order_id uuid not null,
  revision bigint not null,
  foreign key(event_slug,order_id) references sonder_orders(event_slug,id) on update cascade on delete restrict
);
-- Both admission writes and mapping changes lock the same event row. A stale
-- native form cannot race a provider switch and manufacture a second ticket.
create or replace function guard_sonder_mapping() returns trigger language plpgsql as $$
begin
  update events set updated_at=updated_at where slug=new.event_slug;
  if TG_OP = 'UPDATE' and (old.hangout_id <> new.hangout_id or old.mode <> new.mode) then
    raise exception 'Sonder hangout and mode cannot be replaced';
  end if;
  if TG_OP = 'INSERT' and (
    exists(select 1 from tickets where event_slug = new.event_slug) or
    exists(select 1 from checkout_sessions where event_slug = new.event_slug) or
    exists(select 1 from event_waitlist_entries where event_slug = new.event_slug)
  ) then raise exception 'Native ticket, checkout or waitlist history needs a separate handover'; end if;
  return new;
end $$;
create trigger sonder_mapping_authority before insert or update of hangout_id,mode
  on sonder_event_links for each row execute function guard_sonder_mapping();
create or replace function guard_native_sonder_write() returns trigger language plpgsql as $$
begin
  update events set updated_at=updated_at where slug=new.event_slug;
  if exists(select 1 from sonder_event_links where event_slug = new.event_slug) then
    raise exception 'This occurrence uses Sonder for ticketing';
  end if;
  return new;
end $$;
create trigger tickets_sonder_authority before insert or update of event_slug on tickets
  for each row execute function guard_native_sonder_write();
create trigger checkouts_sonder_authority before insert or update of event_slug on checkout_sessions
  for each row execute function guard_native_sonder_write();
create trigger waitlist_sonder_authority before insert on event_waitlist_entries
  for each row execute function guard_native_sonder_write();
create or replace function prevent_sonder_unmapping() returns trigger language plpgsql as $$
begin raise exception 'Sonder occurrence mappings require an explicit handover'; end $$;
create trigger sonder_no_unmapping before delete on sonder_event_links
  for each row execute function prevent_sonder_unmapping();
create or replace function guard_sonder_team_group() returns trigger language plpgsql as $$
begin
  if new.ends_at is null and exists(select 1 from sonder_tickets t join sonder_orders o on o.event_slug=t.event_slug and o.id=t.order_id where t.participant_id=new.participant_id and o.team_id is distinct from new.team_id) then
    raise exception 'Move the whole Sonder booking group';
  end if;
  return new;
end $$;
create trigger sonder_whole_booking_teams before insert or update on score_team_memberships
  for each row execute function guard_sonder_team_group();
`;

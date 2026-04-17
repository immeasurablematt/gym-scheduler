create table if not exists team_members (
  slack_user_id text primary key,
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists team_member_owner_aliases (
  id uuid primary key default gen_random_uuid(),
  slack_user_id text not null references team_members(slack_user_id) on delete cascade,
  normalized_alias text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger team_members_set_updated_at
before update on team_members
for each row
execute function set_updated_at();
create trigger team_member_owner_aliases_set_updated_at
before update on team_member_owner_aliases
for each row
execute function set_updated_at();

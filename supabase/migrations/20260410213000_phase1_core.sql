create extension if not exists pgcrypto;
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create table raid_posts (
  id uuid primary key default gen_random_uuid(),
  post_url text not null,
  client_name text not null,
  platform text not null,
  created_by_slack_user_id text not null,
  published_at timestamptz,
  slack_posted_at timestamptz not null,
  slack_message_ts text not null,
  slack_channel_id text not null,
  timing_confidence text not null,
  month_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slack_channel_id, slack_message_ts)
);
create table engagement_logs (
  id uuid primary key default gen_random_uuid(),
  raid_post_id uuid not null references raid_posts(id) on delete cascade,
  slack_user_id text not null,
  slack_reaction text not null,
  action_type text not null,
  reacted_at timestamptz not null,
  minutes_from_publish integer not null,
  scoring_window text not null,
  points_awarded integer not null,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index engagement_logs_one_action_per_user_post
  on engagement_logs (raid_post_id, slack_user_id, action_type);
create table raid_timing_corrections (
  id uuid primary key default gen_random_uuid(),
  raid_post_id uuid not null references raid_posts(id) on delete cascade,
  previous_published_at timestamptz,
  new_published_at timestamptz not null,
  previous_timing_confidence text not null,
  new_timing_confidence text not null,
  corrected_by text not null,
  reason text not null,
  corrected_at timestamptz not null default now()
);
create trigger raid_posts_set_updated_at
before update on raid_posts
for each row
execute function set_updated_at();
create trigger engagement_logs_set_updated_at
before update on engagement_logs
for each row
execute function set_updated_at();

create table if not exists monthly_summary_snapshots (
  month_key text primary key,
  total_points integer not null,
  unique_raids_engaged integer not null,
  early_window_actions integer not null,
  total_actions integer not null,
  early_window_action_rate numeric not null,
  snapshot_at timestamptz not null default now()
);
create table if not exists monthly_score_snapshots (
  month_key text not null references monthly_summary_snapshots(month_key) on delete cascade,
  slack_user_id text not null,
  display_name text not null,
  rank integer not null,
  total_points integer not null,
  unique_raids_engaged integer not null,
  early_window_actions integer not null,
  total_actions integer not null,
  early_window_action_rate numeric not null,
  snapshot_at timestamptz not null default now(),
  primary key (month_key, slack_user_id)
);
create table if not exists job_runs (
  job_name text not null,
  window_key text not null,
  details text not null default '',
  completed_at timestamptz not null default now(),
  primary key (job_name, window_key)
);
create table if not exists ops_alert_publications (
  raid_post_id uuid not null references raid_posts(id) on delete cascade,
  alert_type text not null,
  alert_window_key text not null,
  published_at timestamptz not null default now(),
  primary key (raid_post_id, alert_type, alert_window_key)
);
create index if not exists raid_posts_month_key_idx
  on raid_posts (month_key);
create index if not exists raid_posts_published_at_idx
  on raid_posts (published_at);
create index if not exists engagement_logs_raid_removed_idx
  on engagement_logs (raid_post_id, removed_at);

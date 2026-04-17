alter table raid_posts
  add column if not exists normalized_post_url text,
  add column if not exists source_event_id text,
  add column if not exists owner_external_id text,
  add column if not exists owner_display_name text,
  add column if not exists owner_slack_user_id text;
update raid_posts
set normalized_post_url = lower(
  regexp_replace(
    split_part(split_part(post_url, '#', 1), '?', 1),
    '/+$',
    ''
  )
)
where normalized_post_url is null;
alter table raid_posts
  alter column normalized_post_url set not null;
create unique index if not exists raid_posts_platform_normalized_post_url_key
  on raid_posts (platform, normalized_post_url);
create unique index if not exists raid_posts_source_event_id_key
  on raid_posts (source_event_id)
  where source_event_id is not null;

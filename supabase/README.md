# Supabase Schema Notes

`schema.sql` is the current fresh-database baseline for GymScheduler.

The files in `migrations/` are historical migration records for linked Supabase
projects. Some early migrations mention older Slack/raid tables from a previous
project history. Keep those files in place unless remote migration history is
explicitly reconciled; deleting or moving applied migrations can create Supabase
history drift.

For a new GymScheduler database, bootstrap from `schema.sql`, then apply only
new migrations created after this baseline.

`bootstrap_schedule_slice.sql` is an older minimal smoke-test bootstrap kept for
reference. Prefer `schema.sql` for current app setup.

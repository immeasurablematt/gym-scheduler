-- Additive reconciliation for the live SMS runtime.
-- The MVP migration is left untouched; this only fills remote schema gaps
-- required by lib/sms/client-directory.ts and lib/sms/availability-engine.ts.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_number TEXT;

ALTER TABLE trainers
  ADD COLUMN IF NOT EXISTS available_hours JSONB;

NOTIFY pgrst, 'reload schema';

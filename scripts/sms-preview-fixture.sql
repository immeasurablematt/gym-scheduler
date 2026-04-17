-- SMS preview fixture patch
--
-- Run this after the schema is fixed enough for the SMS runtime to read:
-- - users.phone_number
-- - trainers.available_hours
-- - availability_templates
-- - blocked_time_slots
--
-- This keeps the existing Preview Trainer / Preview Client records and only
-- patches the parts the SMS workflow needs.
--
-- User inputs still required:
-- - client phone number to receive SMS, in E.164 or a 10-digit US/Canada format
-- - whether to keep the default Mon-Fri 09:00-17:00 availability window
-- - optional SMS_TIME_ZONE app env if your test should use something other than America/Toronto

BEGIN;

UPDATE users
SET phone_number = '+16475550101'
WHERE id = 'client-preview-1';

UPDATE trainers
SET available_hours = '{
  "monday": [{"start": "09:00", "end": "17:00"}],
  "tuesday": [{"start": "09:00", "end": "17:00"}],
  "wednesday": [{"start": "09:00", "end": "17:00"}],
  "thursday": [{"start": "09:00", "end": "17:00"}],
  "friday": [{"start": "09:00", "end": "17:00"}]
}'::jsonb
WHERE id = '11111111-1111-1111-1111-111111111111';

INSERT INTO availability_templates (
  id,
  trainer_id,
  day_of_week,
  start_time,
  end_time,
  is_active
)
VALUES
  ('66666666-6666-6666-6666-666666666661', '11111111-1111-1111-1111-111111111111', 1, '09:00', '17:00', true),
  ('66666666-6666-6666-6666-666666666662', '11111111-1111-1111-1111-111111111111', 2, '09:00', '17:00', true),
  ('66666666-6666-6666-6666-666666666663', '11111111-1111-1111-1111-111111111111', 3, '09:00', '17:00', true),
  ('66666666-6666-6666-6666-666666666664', '11111111-1111-1111-1111-111111111111', 4, '09:00', '17:00', true),
  ('66666666-6666-6666-6666-666666666665', '11111111-1111-1111-1111-111111111111', 5, '09:00', '17:00', true)
ON CONFLICT (id) DO UPDATE
SET
  trainer_id = EXCLUDED.trainer_id,
  day_of_week = EXCLUDED.day_of_week,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  is_active = EXCLUDED.is_active;

COMMIT;

-- Quick verification checklist:
-- 1. users.id = 'client-preview-1' has a non-null phone_number.
-- 2. trainers.id = '11111111-1111-1111-1111-111111111111' has either:
--    - active availability_templates rows, or
--    - a non-null available_hours JSON fallback.
-- 3. `node scripts/twilio-webhook-smoke.mjs` still passes once the app is running.

-- Minimal seed data for local preview mode.
-- Run this after bootstrap_schedule_slice.sql.
-- Seeds enough data to verify the first read/update/create schedule slices.

INSERT INTO users (id, email, full_name, role, phone_number)
VALUES
  ('trainer-preview-1', 'trainer@example.com', 'Preview Trainer', 'trainer', '+16475550100'),
  ('client-preview-1', 'client@example.com', 'Preview Client', 'client', '+16475550101')
ON CONFLICT (id) DO UPDATE
SET
  email = EXCLUDED.email,
  full_name = EXCLUDED.full_name,
  phone_number = EXCLUDED.phone_number,
  role = EXCLUDED.role;

INSERT INTO trainers (id, user_id, hourly_rate)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'trainer-preview-1', 85.00)
ON CONFLICT (user_id) DO UPDATE
SET hourly_rate = EXCLUDED.hourly_rate;

INSERT INTO clients (id, user_id, trainer_id)
VALUES
  (
    '22222222-2222-2222-2222-222222222222',
    'client-preview-1',
    '11111111-1111-1111-1111-111111111111'
  )
ON CONFLICT (user_id) DO UPDATE
SET trainer_id = EXCLUDED.trainer_id;

INSERT INTO gym_spaces (id, name, area, capacity)
VALUES
  ('33333333-3333-3333-3333-333333333333', 'Weight Floor', 'weights', 12)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  area = EXCLUDED.area,
  capacity = EXCLUDED.capacity;

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

INSERT INTO sessions (
  id,
  trainer_id,
  client_id,
  gym_space_id,
  scheduled_at,
  duration_minutes,
  status,
  session_type,
  notes
)
VALUES
  (
    '44444444-4444-4444-4444-444444444444',
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333',
    NOW() + INTERVAL '1 day',
    60,
    'scheduled',
    'Strength Training',
    'Preview session for dashboard and schedule testing'
  ),
  (
    '55555555-5555-5555-5555-555555555555',
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333',
    NOW() - INTERVAL '1 day',
    60,
    'completed',
    'Mobility',
    'Completed seed session for weekly stats'
  )
ON CONFLICT (id) DO UPDATE
SET
  scheduled_at = EXCLUDED.scheduled_at,
  duration_minutes = EXCLUDED.duration_minutes,
  status = EXCLUDED.status,
  session_type = EXCLUDED.session_type,
  notes = EXCLUDED.notes,
  gym_space_id = EXCLUDED.gym_space_id;

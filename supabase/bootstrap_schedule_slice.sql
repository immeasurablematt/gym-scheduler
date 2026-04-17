-- Minimal bootstrap for the first scheduling vertical slice.
-- Safe to run on a fresh Supabase project before testing:
-- - /dashboard real reads
-- - /dashboard/schedule real reads
-- - POST /api/sessions
-- - PATCH /api/sessions/[sessionId]
-- - session_changes activity logging

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('trainer', 'client', 'admin');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_status') THEN
    CREATE TYPE session_status AS ENUM ('scheduled', 'completed', 'cancelled', 'no_show');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gym_area') THEN
    CREATE TYPE gym_area AS ENUM ('weights', 'cardio', 'studio', 'pool', 'outdoor');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sms_direction') THEN
    CREATE TYPE sms_direction AS ENUM ('inbound', 'outbound');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sms_message_status') THEN
    CREATE TYPE sms_message_status AS ENUM ('received', 'queued', 'sent', 'delivered', 'failed');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sms_offer_status') THEN
    CREATE TYPE sms_offer_status AS ENUM ('pending', 'booked', 'expired', 'conflicted');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sms_webhook_status') THEN
    CREATE TYPE sms_webhook_status AS ENUM ('received', 'processed', 'failed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    role user_role NOT NULL,
    phone_number TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trainers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hourly_rate DECIMAL(10, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trainer_id UUID REFERENCES trainers(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gym_spaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    area gym_area NOT NULL,
    capacity INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    gym_space_id UUID REFERENCES gym_spaces(id) ON DELETE SET NULL,
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    status session_status NOT NULL DEFAULT 'scheduled',
    session_type TEXT NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS session_changes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    changed_by TEXT NOT NULL REFERENCES users(id),
    change_type TEXT NOT NULL,
    old_values JSONB,
    new_values JSONB,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS availability_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT bootstrap_valid_day_of_week CHECK (day_of_week >= 0 AND day_of_week <= 6),
    CONSTRAINT bootstrap_valid_time_range CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS blocked_time_slots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trainer_id UUID REFERENCES trainers(id) ON DELETE CASCADE,
    gym_space_id UUID REFERENCES gym_spaces(id) ON DELETE CASCADE,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    reason TEXT,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sms_webhook_idempotency (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider TEXT NOT NULL,
    event_key TEXT NOT NULL,
    from_phone TEXT,
    status sms_webhook_status NOT NULL DEFAULT 'received',
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT bootstrap_sms_webhook_provider_event_unique UNIQUE (provider, event_key)
);

CREATE TABLE IF NOT EXISTS sms_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider TEXT NOT NULL DEFAULT 'twilio',
    direction sms_direction NOT NULL,
    status sms_message_status NOT NULL DEFAULT 'received',
    message_sid TEXT UNIQUE,
    account_sid TEXT,
    from_phone TEXT NOT NULL,
    to_phone TEXT NOT NULL,
    normalized_from_phone TEXT NOT NULL,
    normalized_to_phone TEXT NOT NULL,
    body TEXT NOT NULL,
    error_message TEXT,
    offer_set_id UUID,
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    trainer_id UUID REFERENCES trainers(id) ON DELETE SET NULL,
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sms_booking_offers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    offer_set_id UUID NOT NULL,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    offered_by_message_id UUID REFERENCES sms_messages(id) ON DELETE SET NULL,
    selected_by_message_id UUID REFERENCES sms_messages(id) ON DELETE SET NULL,
    booked_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    slot_position INTEGER NOT NULL,
    slot_starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
    slot_ends_at TIMESTAMP WITH TIME ZONE NOT NULL,
    time_zone TEXT NOT NULL,
    status sms_offer_status NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT bootstrap_sms_booking_offers_slot_range CHECK (slot_ends_at > slot_starts_at),
    CONSTRAINT bootstrap_sms_booking_offers_slot_position CHECK (slot_position >= 1 AND slot_position <= 9),
    CONSTRAINT bootstrap_sms_booking_offer_slot_unique UNIQUE (offer_set_id, slot_position)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_unique_trainer_time
  ON sessions(trainer_id, scheduled_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_unique_client_time
  ON sessions(client_id, scheduled_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_unique_space_time
  ON sessions(gym_space_id, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_sessions_scheduled_at
  ON sessions(scheduled_at);

CREATE INDEX IF NOT EXISTS idx_session_changes_session_id
  ON session_changes(session_id);

CREATE INDEX IF NOT EXISTS idx_availability_templates_trainer_id
  ON availability_templates(trainer_id);

CREATE INDEX IF NOT EXISTS idx_blocked_time_slots_trainer_id
  ON blocked_time_slots(trainer_id);

CREATE INDEX IF NOT EXISTS idx_sms_messages_created_at
  ON sms_messages(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_booking_offers_client_trainer_status
  ON sms_booking_offers(client_id, trainer_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp_users ON users;
CREATE TRIGGER set_timestamp_users
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS set_timestamp_trainers ON trainers;
CREATE TRIGGER set_timestamp_trainers
  BEFORE UPDATE ON trainers
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS set_timestamp_clients ON clients;
CREATE TRIGGER set_timestamp_clients
  BEFORE UPDATE ON clients
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS set_timestamp_gym_spaces ON gym_spaces;
CREATE TRIGGER set_timestamp_gym_spaces
  BEFORE UPDATE ON gym_spaces
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS set_timestamp_sessions ON sessions;
CREATE TRIGGER set_timestamp_sessions
  BEFORE UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS set_timestamp_availability_templates ON availability_templates;
CREATE TRIGGER set_timestamp_availability_templates
  BEFORE UPDATE ON availability_templates
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS set_timestamp_sms_booking_offers ON sms_booking_offers;
CREATE TRIGGER set_timestamp_sms_booking_offers
  BEFORE UPDATE ON sms_booking_offers
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_timestamp();

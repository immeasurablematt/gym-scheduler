-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Normalize phone numbers for SMS lookups and logging.
CREATE OR REPLACE FUNCTION normalize_phone_number(input TEXT)
RETURNS TEXT AS $$
DECLARE
    digits TEXT;
BEGIN
    IF input IS NULL THEN
        RETURN NULL;
    END IF;

    digits := regexp_replace(input, '[^0-9]', '', 'g');

    IF digits = '' THEN
        RETURN NULL;
    END IF;

    IF left(trim(input), 1) = '+' THEN
        RETURN '+' || digits;
    END IF;

    IF length(digits) = 10 THEN
        RETURN '+1' || digits;
    END IF;

    IF length(digits) = 11 AND left(digits, 1) = '1' THEN
        RETURN '+' || digits;
    END IF;

    RETURN '+' || digits;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create enum types
CREATE TYPE user_role AS ENUM ('trainer', 'client', 'admin');
CREATE TYPE session_status AS ENUM ('scheduled', 'completed', 'cancelled', 'no_show');
CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded');
CREATE TYPE gym_area AS ENUM ('weights', 'cardio', 'studio', 'pool', 'outdoor');
CREATE TYPE sms_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE sms_message_status AS ENUM ('received', 'queued', 'sent', 'delivered', 'failed');
CREATE TYPE sms_offer_status AS ENUM ('pending', 'booked', 'expired', 'conflicted');
CREATE TYPE sms_webhook_status AS ENUM ('received', 'processed', 'failed');
CREATE TYPE sms_message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE sms_offer_status AS ENUM ('pending', 'booked', 'expired', 'cancelled');

-- Users table (extends Clerk auth)
CREATE TABLE users (
    id TEXT PRIMARY KEY, -- Clerk user ID
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    role user_role NOT NULL,
    phone_number TEXT,
    phone_number_normalized TEXT GENERATED ALWAYS AS (normalize_phone_number(phone_number)) STORED,
    emergency_contact TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Trainers table
CREATE TABLE trainers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    specializations TEXT[],
    bio TEXT,
    hourly_rate DECIMAL(10, 2),
    max_clients INTEGER DEFAULT 10,
    available_hours JSONB, -- Store weekly availability
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Clients table
CREATE TABLE clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trainer_id UUID REFERENCES trainers(id) ON DELETE SET NULL,
    fitness_goals TEXT,
    medical_conditions TEXT,
    membership_start_date DATE,
    membership_end_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Gym spaces table
CREATE TABLE gym_spaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    area gym_area NOT NULL,
    capacity INTEGER NOT NULL,
    equipment TEXT[],
    is_available BOOLEAN DEFAULT true,
    coordinates JSONB, -- For 3D visualization
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Sessions table
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    gym_space_id UUID REFERENCES gym_spaces(id) ON DELETE SET NULL,
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    status session_status DEFAULT 'scheduled',
    session_type TEXT NOT NULL,
    notes TEXT,
    calendar_event_provider TEXT,
    calendar_external_id TEXT,
    calendar_sync_status TEXT NOT NULL DEFAULT 'not_synced',
    calendar_last_synced_at TIMESTAMP WITH TIME ZONE,
    calendar_sync_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT no_double_booking_trainer UNIQUE (trainer_id, scheduled_at),
    CONSTRAINT no_double_booking_client UNIQUE (client_id, scheduled_at),
    CONSTRAINT no_double_booking_space UNIQUE (gym_space_id, scheduled_at)
);

CREATE TABLE trainer_calendar_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'google',
    google_calendar_id TEXT,
    google_calendar_email TEXT,
    calendar_time_zone TEXT,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    sync_enabled BOOLEAN NOT NULL DEFAULT true,
    last_sync_at TIMESTAMP WITH TIME ZONE,
    last_sync_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE calendar_sync_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'google',
    status TEXT NOT NULL DEFAULT 'queued',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- SMS message log for inbound/outbound scheduling traffic.
CREATE TABLE sms_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    direction sms_message_direction NOT NULL,
    provider TEXT NOT NULL DEFAULT 'twilio',
    body TEXT NOT NULL,
    raw_from_phone_number TEXT,
    raw_to_phone_number TEXT,
    normalized_from_phone_number TEXT NOT NULL,
    normalized_to_phone_number TEXT NOT NULL,
    twilio_message_sid TEXT UNIQUE,
    twilio_account_sid TEXT,
    twilio_status TEXT,
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    trainer_id UUID REFERENCES trainers(id) ON DELETE SET NULL,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    related_message_id UUID REFERENCES sms_messages(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sms_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active',
    intent TEXT,
    state TEXT,
    target_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    offer_set_id UUID,
    context JSONB NOT NULL DEFAULT '{}'::jsonb,
    expires_at TIMESTAMP WITH TIME ZONE,
    last_inbound_message_id UUID REFERENCES sms_messages(id) ON DELETE SET NULL,
    last_outbound_message_id UUID REFERENCES sms_messages(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Durable idempotency/event log for Twilio webhook processing.
CREATE TABLE sms_webhook_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider TEXT NOT NULL DEFAULT 'twilio',
    event_type TEXT NOT NULL,
    event_key TEXT NOT NULL,
    twilio_message_sid TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    processed_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '2 days'),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT sms_webhook_events_provider_event_key_key UNIQUE (provider, event_key)
);

-- Ephemeral offer rows let SMS confirmation map back to a concrete slot.
CREATE TABLE sms_slot_offers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    offer_set_id UUID NOT NULL DEFAULT uuid_generate_v4(),
    selection_index SMALLINT NOT NULL,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    outbound_message_id UUID REFERENCES sms_messages(id) ON DELETE SET NULL,
    booked_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    offered_start_at TIMESTAMP WITH TIME ZONE NOT NULL,
    offered_end_at TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status sms_offer_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT sms_slot_offers_selection_index_check CHECK (selection_index >= 1 AND selection_index <= 3),
    CONSTRAINT sms_slot_offers_time_range_check CHECK (offered_end_at > offered_start_at),
    CONSTRAINT sms_slot_offers_offer_set_selection_key UNIQUE (offer_set_id, selection_index)
);

-- Session changes/cancellations log
CREATE TABLE session_changes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    changed_by TEXT NOT NULL REFERENCES users(id),
    change_type TEXT NOT NULL, -- 'rescheduled', 'cancelled', 'modified'
    old_values JSONB,
    new_values JSONB,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Payments table
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    amount DECIMAL(10, 2) NOT NULL,
    status payment_status DEFAULT 'pending',
    stripe_payment_intent_id TEXT,
    stripe_charge_id TEXT,
    payment_method TEXT,
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Notifications preferences
CREATE TABLE notification_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email_reminders BOOLEAN DEFAULT true,
    sms_reminders BOOLEAN DEFAULT false,
    reminder_hours_before INTEGER DEFAULT 24,
    cancellation_notifications BOOLEAN DEFAULT true,
    payment_notifications BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Availability templates (for trainers)
CREATE TABLE availability_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL, -- 0-6 (Sunday-Saturday)
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_day_of_week CHECK (day_of_week >= 0 AND day_of_week <= 6),
    CONSTRAINT valid_time_range CHECK (end_time > start_time)
);

-- Blocked time slots (for holidays, maintenance, etc.)
CREATE TABLE blocked_time_slots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trainer_id UUID REFERENCES trainers(id) ON DELETE CASCADE,
    gym_space_id UUID REFERENCES gym_spaces(id) ON DELETE CASCADE,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    reason TEXT,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_block_time_range CHECK (end_time > start_time),
    CONSTRAINT has_target CHECK (trainer_id IS NOT NULL OR gym_space_id IS NOT NULL)
);

-- SMS webhook idempotency
CREATE TABLE sms_webhook_idempotency (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider TEXT NOT NULL,
    event_key TEXT NOT NULL,
    from_phone TEXT,
    status sms_webhook_status NOT NULL DEFAULT 'received',
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT sms_webhook_idempotency_provider_event_unique UNIQUE (provider, event_key)
);

-- SMS message log
CREATE TABLE sms_messages (
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

-- SMS offer tracking
CREATE TABLE sms_booking_offers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    offer_set_id UUID NOT NULL,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    offered_by_message_id UUID REFERENCES sms_messages(id) ON DELETE SET NULL,
    selected_by_message_id UUID REFERENCES sms_messages(id) ON DELETE SET NULL,
    booked_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    flow_type TEXT NOT NULL DEFAULT 'booking',
    target_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    slot_position INTEGER NOT NULL,
    slot_starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
    slot_ends_at TIMESTAMP WITH TIME ZONE NOT NULL,
    time_zone TEXT NOT NULL,
    status sms_offer_status NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT sms_booking_offers_slot_range CHECK (slot_ends_at > slot_starts_at),
    CONSTRAINT sms_booking_offers_slot_position CHECK (slot_position >= 1 AND slot_position <= 9),
    CONSTRAINT sms_booking_offers_offer_slot_unique UNIQUE (offer_set_id, slot_position)
);

-- Create indexes for better query performance
CREATE INDEX idx_sessions_trainer_id ON sessions(trainer_id);
CREATE INDEX idx_sessions_client_id ON sessions(client_id);
CREATE INDEX idx_sessions_scheduled_at ON sessions(scheduled_at);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE UNIQUE INDEX idx_trainer_calendar_connections_trainer_id ON trainer_calendar_connections(trainer_id);
CREATE INDEX idx_trainer_calendar_connections_provider_sync_enabled ON trainer_calendar_connections(provider, sync_enabled);
CREATE INDEX idx_calendar_sync_jobs_trainer_id ON calendar_sync_jobs(trainer_id);
CREATE INDEX idx_calendar_sync_jobs_session_id ON calendar_sync_jobs(session_id);
CREATE INDEX idx_calendar_sync_jobs_status_available_at ON calendar_sync_jobs(status, available_at);
CREATE INDEX idx_sms_conversations_client_trainer_status ON sms_conversations(client_id, trainer_id, status);
CREATE INDEX idx_sms_conversations_expires_at ON sms_conversations(expires_at);
CREATE INDEX idx_payments_client_id ON payments(client_id);
CREATE INDEX idx_payments_trainer_id ON payments(trainer_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_phone_number_normalized ON users(phone_number_normalized);
CREATE INDEX idx_availability_templates_trainer_id ON availability_templates(trainer_id);
CREATE INDEX idx_blocked_time_slots_trainer_id ON blocked_time_slots(trainer_id);
CREATE INDEX idx_blocked_time_slots_gym_space_id ON blocked_time_slots(gym_space_id);
CREATE INDEX idx_sms_webhook_idempotency_created_at ON sms_webhook_idempotency(created_at);
CREATE INDEX idx_sms_messages_created_at ON sms_messages(created_at DESC);
CREATE INDEX idx_sms_messages_client_id ON sms_messages(client_id);
CREATE INDEX idx_sms_messages_trainer_id ON sms_messages(trainer_id);
CREATE INDEX idx_sms_messages_offer_set_id ON sms_messages(offer_set_id);
CREATE INDEX idx_sms_booking_offers_client_trainer_status ON sms_booking_offers(client_id, trainer_id, status, created_at DESC);
CREATE INDEX idx_sms_booking_offers_expires_at ON sms_booking_offers(expires_at);
CREATE INDEX idx_sessions_calendar_external_id ON sessions(calendar_external_id);
CREATE INDEX idx_sessions_calendar_sync_status ON sessions(calendar_sync_status);
CREATE INDEX idx_sms_booking_offers_flow_type ON sms_booking_offers(flow_type);
CREATE INDEX idx_sms_booking_offers_target_session_id ON sms_booking_offers(target_session_id);
CREATE INDEX idx_sms_messages_client_id ON sms_messages(client_id);
CREATE INDEX idx_sms_messages_trainer_id ON sms_messages(trainer_id);
CREATE INDEX idx_sms_messages_twilio_status ON sms_messages(twilio_status);
CREATE INDEX idx_sms_messages_normalized_from_phone_number ON sms_messages(normalized_from_phone_number);
CREATE INDEX idx_sms_messages_normalized_to_phone_number ON sms_messages(normalized_to_phone_number);
CREATE INDEX idx_sms_messages_created_at ON sms_messages(created_at);
CREATE INDEX idx_sms_webhook_events_expires_at ON sms_webhook_events(expires_at);
CREATE INDEX idx_sms_webhook_events_twilio_message_sid ON sms_webhook_events(twilio_message_sid);
CREATE INDEX idx_sms_slot_offers_client_id ON sms_slot_offers(client_id);
CREATE INDEX idx_sms_slot_offers_trainer_id ON sms_slot_offers(trainer_id);
CREATE INDEX idx_sms_slot_offers_status_expires_at ON sms_slot_offers(status, expires_at);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER set_timestamp_users
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_trainers
    BEFORE UPDATE ON trainers
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_clients
    BEFORE UPDATE ON clients
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_gym_spaces
    BEFORE UPDATE ON gym_spaces
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_sessions
    BEFORE UPDATE ON sessions
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_payments
    BEFORE UPDATE ON payments
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_notification_preferences
    BEFORE UPDATE ON notification_preferences
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_availability_templates
    BEFORE UPDATE ON availability_templates
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_trainer_calendar_connections
    BEFORE UPDATE ON trainer_calendar_connections
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_calendar_sync_jobs
    BEFORE UPDATE ON calendar_sync_jobs
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_sms_conversations
    BEFORE UPDATE ON sms_conversations
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_sms_booking_offers
    BEFORE UPDATE ON sms_booking_offers
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_sms_messages
    BEFORE UPDATE ON sms_messages
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_sms_webhook_events
    BEFORE UPDATE ON sms_webhook_events
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_sms_slot_offers
    BEFORE UPDATE ON sms_slot_offers
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

-- Row Level Security (RLS) Policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainers ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_slot_offers ENABLE ROW LEVEL SECURITY;

-- Users can read their own data
CREATE POLICY "Users can view own profile" ON users
    FOR SELECT USING (auth.uid()::text = id);

-- Trainers can view their clients
CREATE POLICY "Trainers can view their clients" ON clients
    FOR SELECT USING (
        trainer_id IN (
            SELECT id FROM trainers WHERE user_id = auth.uid()::text
        )
    );

-- Clients can view their trainer
CREATE POLICY "Clients can view their trainer" ON trainers
    FOR SELECT USING (
        id IN (
            SELECT trainer_id FROM clients WHERE user_id = auth.uid()::text
        )
    );

-- Session policies
CREATE POLICY "Users can view their sessions" ON sessions
    FOR SELECT USING (
        trainer_id IN (SELECT id FROM trainers WHERE user_id = auth.uid()::text)
        OR
        client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()::text)
    );

-- Payment policies
CREATE POLICY "Users can view their payments" ON payments
    FOR SELECT USING (
        trainer_id IN (SELECT id FROM trainers WHERE user_id = auth.uid()::text)
        OR
        client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()::text)
    );

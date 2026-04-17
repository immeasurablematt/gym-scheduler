CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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

CREATE TABLE IF NOT EXISTS sms_webhook_idempotency (
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
    CONSTRAINT sms_booking_offers_slot_range CHECK (slot_ends_at > slot_starts_at),
    CONSTRAINT sms_booking_offers_slot_position CHECK (slot_position >= 1 AND slot_position <= 9),
    CONSTRAINT sms_booking_offers_offer_slot_unique UNIQUE (offer_set_id, slot_position)
);

CREATE INDEX IF NOT EXISTS idx_sms_webhook_idempotency_created_at
  ON sms_webhook_idempotency(created_at);

CREATE INDEX IF NOT EXISTS idx_sms_messages_created_at
  ON sms_messages(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_messages_client_id
  ON sms_messages(client_id);

CREATE INDEX IF NOT EXISTS idx_sms_messages_trainer_id
  ON sms_messages(trainer_id);

CREATE INDEX IF NOT EXISTS idx_sms_messages_offer_set_id
  ON sms_messages(offer_set_id);

CREATE INDEX IF NOT EXISTS idx_sms_booking_offers_client_trainer_status
  ON sms_booking_offers(client_id, trainer_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_booking_offers_expires_at
  ON sms_booking_offers(expires_at);

DROP TRIGGER IF EXISTS set_timestamp_sms_booking_offers ON sms_booking_offers;
CREATE TRIGGER set_timestamp_sms_booking_offers
  BEFORE UPDATE ON sms_booking_offers
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_timestamp();

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sms_message_audience') THEN
    CREATE TYPE sms_message_audience AS ENUM ('client', 'trainer');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sms_message_kind') THEN
    CREATE TYPE sms_message_kind AS ENUM ('conversation', 'book', 'reschedule', 'cancel');
  END IF;
END $$;

ALTER TABLE sms_messages
  ADD COLUMN IF NOT EXISTS audience sms_message_audience NOT NULL DEFAULT 'client',
  ADD COLUMN IF NOT EXISTS message_kind sms_message_kind NOT NULL DEFAULT 'conversation',
  ADD COLUMN IF NOT EXISTS source_change_id UUID REFERENCES session_changes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sms_messages_audience_created_at
  ON sms_messages(audience, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_messages_source_change_id
  ON sms_messages(source_change_id);

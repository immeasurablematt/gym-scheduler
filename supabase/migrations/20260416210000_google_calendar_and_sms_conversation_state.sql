-- Additive calendar sync and SMS conversation state schema.

CREATE TABLE IF NOT EXISTS trainer_calendar_connections (
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_trainer_calendar_connections_trainer_id
  ON trainer_calendar_connections(trainer_id);

CREATE INDEX IF NOT EXISTS idx_trainer_calendar_connections_provider_sync_enabled
  ON trainer_calendar_connections(provider, sync_enabled);

DROP TRIGGER IF EXISTS set_timestamp_trainer_calendar_connections ON trainer_calendar_connections;
CREATE TRIGGER set_timestamp_trainer_calendar_connections
  BEFORE UPDATE ON trainer_calendar_connections
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_timestamp();

CREATE TABLE IF NOT EXISTS calendar_sync_jobs (
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

CREATE INDEX IF NOT EXISTS idx_calendar_sync_jobs_trainer_id
  ON calendar_sync_jobs(trainer_id);

CREATE INDEX IF NOT EXISTS idx_calendar_sync_jobs_session_id
  ON calendar_sync_jobs(session_id);

CREATE INDEX IF NOT EXISTS idx_calendar_sync_jobs_status_available_at
  ON calendar_sync_jobs(status, available_at);

DROP TRIGGER IF EXISTS set_timestamp_calendar_sync_jobs ON calendar_sync_jobs;
CREATE TRIGGER set_timestamp_calendar_sync_jobs
  BEFORE UPDATE ON calendar_sync_jobs
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_timestamp();

CREATE TABLE IF NOT EXISTS sms_conversations (
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

CREATE INDEX IF NOT EXISTS idx_sms_conversations_client_trainer_status
  ON sms_conversations(client_id, trainer_id, status);

CREATE INDEX IF NOT EXISTS idx_sms_conversations_expires_at
  ON sms_conversations(expires_at);

DROP TRIGGER IF EXISTS set_timestamp_sms_conversations ON sms_conversations;
CREATE TRIGGER set_timestamp_sms_conversations
  BEFORE UPDATE ON sms_conversations
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_timestamp();

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS calendar_event_provider TEXT;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS calendar_external_id TEXT;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS calendar_sync_status TEXT NOT NULL DEFAULT 'not_synced';

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS calendar_last_synced_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS calendar_sync_error TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_calendar_external_id
  ON sessions(calendar_external_id);

CREATE INDEX IF NOT EXISTS idx_sessions_calendar_sync_status
  ON sessions(calendar_sync_status);

ALTER TABLE sms_booking_offers
  ADD COLUMN IF NOT EXISTS flow_type TEXT NOT NULL DEFAULT 'booking';

ALTER TABLE sms_booking_offers
  ADD COLUMN IF NOT EXISTS target_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sms_booking_offers_flow_type
  ON sms_booking_offers(flow_type);

CREATE INDEX IF NOT EXISTS idx_sms_booking_offers_target_session_id
  ON sms_booking_offers(target_session_id);

NOTIFY pgrst, 'reload schema';

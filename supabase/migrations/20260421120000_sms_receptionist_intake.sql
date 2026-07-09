DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sms_intake_status') THEN
    CREATE TYPE sms_intake_status AS ENUM (
      'collecting_info',
      'awaiting_trainer_approval',
      'approved',
      'rejected',
      'expired',
      'needs_manual_review'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sms_intake_conversation_state') THEN
    CREATE TYPE sms_intake_conversation_state AS ENUM (
      'needs_trainer',
      'needs_name',
      'needs_email',
      'needs_preferences',
      'ready_for_approval',
      'awaiting_trainer_reply'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sms_trainer_approval_status') THEN
    CREATE TYPE sms_trainer_approval_status AS ENUM (
      'pending',
      'approved',
      'rejected',
      'expired'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sms_intake_leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    raw_phone TEXT NOT NULL,
    normalized_phone TEXT NOT NULL,
    requested_trainer_name_raw TEXT,
    requested_trainer_id UUID REFERENCES trainers(id) ON DELETE SET NULL,
    client_name TEXT,
    email TEXT,
    scheduling_preferences_text TEXT,
    scheduling_preferences_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status sms_intake_status NOT NULL DEFAULT 'collecting_info',
    conversation_state sms_intake_conversation_state NOT NULL DEFAULT 'needs_trainer',
    summary_for_trainer TEXT,
    last_inbound_message_id UUID REFERENCES sms_messages(id) ON DELETE SET NULL,
    last_outbound_message_id UUID REFERENCES sms_messages(id) ON DELETE SET NULL,
    approved_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    approved_client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sms_trainer_approval_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id UUID NOT NULL REFERENCES sms_intake_leads(id) ON DELETE CASCADE,
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    request_code TEXT NOT NULL,
    status sms_trainer_approval_status NOT NULL DEFAULT 'pending',
    outbound_message_id UUID REFERENCES sms_messages(id) ON DELETE SET NULL,
    decision_message_id UUID REFERENCES sms_messages(id) ON DELETE SET NULL,
    decided_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sms_intake_leads_normalized_phone
  ON sms_intake_leads(normalized_phone);

CREATE INDEX IF NOT EXISTS idx_sms_intake_leads_requested_trainer_id
  ON sms_intake_leads(requested_trainer_id);

CREATE INDEX IF NOT EXISTS idx_sms_intake_leads_status_updated_at
  ON sms_intake_leads(status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_intake_leads_active_normalized_phone
  ON sms_intake_leads(normalized_phone)
  WHERE status NOT IN ('approved', 'rejected', 'expired');

CREATE INDEX IF NOT EXISTS idx_sms_trainer_approval_requests_lead_id
  ON sms_trainer_approval_requests(lead_id);

CREATE INDEX IF NOT EXISTS idx_sms_trainer_approval_requests_trainer_id
  ON sms_trainer_approval_requests(trainer_id);

CREATE INDEX IF NOT EXISTS idx_sms_trainer_approval_requests_status_expires_at
  ON sms_trainer_approval_requests(status, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_trainer_approval_requests_pending_request_code
  ON sms_trainer_approval_requests(request_code)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_trainer_approval_requests_pending_lead_id
  ON sms_trainer_approval_requests(lead_id)
  WHERE status = 'pending';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sms_trainer_approval_requests_state_timestamps_check'
  ) THEN
    ALTER TABLE sms_trainer_approval_requests
      ADD CONSTRAINT sms_trainer_approval_requests_state_timestamps_check
      CHECK (
        (status = 'pending' AND expires_at IS NOT NULL AND decided_at IS NULL)
        OR (status IN ('approved', 'rejected', 'expired') AND decided_at IS NOT NULL)
      );
  END IF;
END $$;

DROP TRIGGER IF EXISTS set_timestamp_sms_intake_leads ON sms_intake_leads;
CREATE TRIGGER set_timestamp_sms_intake_leads
  BEFORE UPDATE ON sms_intake_leads
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS set_timestamp_sms_trainer_approval_requests ON sms_trainer_approval_requests;
CREATE TRIGGER set_timestamp_sms_trainer_approval_requests
  BEFORE UPDATE ON sms_trainer_approval_requests
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_timestamp();

NOTIFY pgrst, 'reload schema';

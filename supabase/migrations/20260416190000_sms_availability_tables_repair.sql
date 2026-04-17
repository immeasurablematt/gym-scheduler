-- Additive repair for SMS scheduling runtime tables that are still missing
-- in the linked Supabase project's public schema.

CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS availability_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_day_of_week CHECK (day_of_week >= 0 AND day_of_week <= 6),
    CONSTRAINT valid_time_range CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS blocked_time_slots (
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

CREATE INDEX IF NOT EXISTS idx_availability_templates_trainer_id
  ON availability_templates(trainer_id);

CREATE INDEX IF NOT EXISTS idx_blocked_time_slots_trainer_id
  ON blocked_time_slots(trainer_id);

CREATE INDEX IF NOT EXISTS idx_blocked_time_slots_gym_space_id
  ON blocked_time_slots(gym_space_id);

DROP TRIGGER IF EXISTS set_timestamp_availability_templates ON availability_templates;
CREATE TRIGGER set_timestamp_availability_templates
  BEFORE UPDATE ON availability_templates
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_timestamp();

NOTIFY pgrst, 'reload schema';

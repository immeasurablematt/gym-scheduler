export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          full_name: string
          role: 'trainer' | 'client' | 'admin'
          phone_number: string | null
          emergency_contact: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name: string
          role: 'trainer' | 'client' | 'admin'
          phone_number?: string | null
          emergency_contact?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string
          role?: 'trainer' | 'client' | 'admin'
          phone_number?: string | null
          emergency_contact?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      trainers: {
        Row: {
          id: string
          user_id: string
          specializations: string[] | null
          bio: string | null
          hourly_rate: number | null
          max_clients: number
          available_hours: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          specializations?: string[] | null
          bio?: string | null
          hourly_rate?: number | null
          max_clients?: number
          available_hours?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          specializations?: string[] | null
          bio?: string | null
          hourly_rate?: number | null
          max_clients?: number
          available_hours?: Json | null
          created_at?: string
          updated_at?: string
        }
      }
      clients: {
        Row: {
          id: string
          user_id: string
          trainer_id: string | null
          fitness_goals: string | null
          medical_conditions: string | null
          membership_start_date: string | null
          membership_end_date: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          trainer_id?: string | null
          fitness_goals?: string | null
          medical_conditions?: string | null
          membership_start_date?: string | null
          membership_end_date?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          trainer_id?: string | null
          fitness_goals?: string | null
          medical_conditions?: string | null
          membership_start_date?: string | null
          membership_end_date?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      gym_spaces: {
        Row: {
          id: string
          name: string
          area: 'weights' | 'cardio' | 'studio' | 'pool' | 'outdoor'
          capacity: number
          equipment: string[] | null
          is_available: boolean
          coordinates: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          area: 'weights' | 'cardio' | 'studio' | 'pool' | 'outdoor'
          capacity: number
          equipment?: string[] | null
          is_available?: boolean
          coordinates?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          area?: 'weights' | 'cardio' | 'studio' | 'pool' | 'outdoor'
          capacity?: number
          equipment?: string[] | null
          is_available?: boolean
          coordinates?: Json | null
          created_at?: string
          updated_at?: string
        }
      }
      sessions: {
        Row: {
          id: string
          trainer_id: string
          client_id: string
          gym_space_id: string | null
          scheduled_at: string
          duration_minutes: number
          status: 'scheduled' | 'completed' | 'cancelled' | 'no_show'
          session_type: string
          notes: string | null
          calendar_event_provider: string | null
          calendar_external_id: string | null
          calendar_sync_status: string
          calendar_last_synced_at: string | null
          calendar_sync_error: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          trainer_id: string
          client_id: string
          gym_space_id?: string | null
          scheduled_at: string
          duration_minutes?: number
          status?: 'scheduled' | 'completed' | 'cancelled' | 'no_show'
          session_type: string
          notes?: string | null
          calendar_event_provider?: string | null
          calendar_external_id?: string | null
          calendar_sync_status?: string
          calendar_last_synced_at?: string | null
          calendar_sync_error?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          trainer_id?: string
          client_id?: string
          gym_space_id?: string | null
          scheduled_at?: string
          duration_minutes?: number
          status?: 'scheduled' | 'completed' | 'cancelled' | 'no_show'
          session_type?: string
          notes?: string | null
          calendar_event_provider?: string | null
          calendar_external_id?: string | null
          calendar_sync_status?: string
          calendar_last_synced_at?: string | null
          calendar_sync_error?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      trainer_calendar_connections: {
        Row: {
          id: string
          trainer_id: string
          provider: string
          google_calendar_id: string | null
          google_calendar_email: string | null
          calendar_time_zone: string | null
          access_token: string | null
          refresh_token: string | null
          token_expires_at: string | null
          sync_enabled: boolean
          last_sync_at: string | null
          last_sync_error: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          trainer_id: string
          provider?: string
          google_calendar_id?: string | null
          google_calendar_email?: string | null
          calendar_time_zone?: string | null
          access_token?: string | null
          refresh_token?: string | null
          token_expires_at?: string | null
          sync_enabled?: boolean
          last_sync_at?: string | null
          last_sync_error?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          trainer_id?: string
          provider?: string
          google_calendar_id?: string | null
          google_calendar_email?: string | null
          calendar_time_zone?: string | null
          access_token?: string | null
          refresh_token?: string | null
          token_expires_at?: string | null
          sync_enabled?: boolean
          last_sync_at?: string | null
          last_sync_error?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      calendar_sync_jobs: {
        Row: {
          id: string
          trainer_id: string
          session_id: string
          provider: string
          status: string
          attempt_count: number
          available_at: string
          processed_at: string | null
          last_error: string | null
          payload: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          trainer_id: string
          session_id: string
          provider?: string
          status?: string
          attempt_count?: number
          available_at?: string
          processed_at?: string | null
          last_error?: string | null
          payload?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          trainer_id?: string
          session_id?: string
          provider?: string
          status?: string
          attempt_count?: number
          available_at?: string
          processed_at?: string | null
          last_error?: string | null
          payload?: Json
          created_at?: string
          updated_at?: string
        }
      }
      sms_conversations: {
        Row: {
          id: string
          client_id: string
          trainer_id: string
          status: string
          intent: string | null
          state: string | null
          target_session_id: string | null
          offer_set_id: string | null
          context: Json
          expires_at: string | null
          last_inbound_message_id: string | null
          last_outbound_message_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          client_id: string
          trainer_id: string
          status?: string
          intent?: string | null
          state?: string | null
          target_session_id?: string | null
          offer_set_id?: string | null
          context?: Json
          expires_at?: string | null
          last_inbound_message_id?: string | null
          last_outbound_message_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          client_id?: string
          trainer_id?: string
          status?: string
          intent?: string | null
          state?: string | null
          target_session_id?: string | null
          offer_set_id?: string | null
          context?: Json
          expires_at?: string | null
          last_inbound_message_id?: string | null
          last_outbound_message_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      sms_intake_leads: {
        Row: {
          id: string
          raw_phone: string
          normalized_phone: string
          requested_trainer_name_raw: string | null
          requested_trainer_id: string | null
          client_name: string | null
          email: string | null
          scheduling_preferences_text: string | null
          scheduling_preferences_json: Json
          status: 'collecting_info' | 'awaiting_trainer_approval' | 'approved' | 'rejected' | 'expired' | 'needs_manual_review'
          conversation_state: 'needs_trainer' | 'needs_name' | 'needs_email' | 'needs_preferences' | 'ready_for_approval' | 'awaiting_trainer_reply'
          summary_for_trainer: string | null
          last_inbound_message_id: string | null
          last_outbound_message_id: string | null
          approved_user_id: string | null
          approved_client_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          raw_phone: string
          normalized_phone: string
          requested_trainer_name_raw?: string | null
          requested_trainer_id?: string | null
          client_name?: string | null
          email?: string | null
          scheduling_preferences_text?: string | null
          scheduling_preferences_json?: Json
          status?: 'collecting_info' | 'awaiting_trainer_approval' | 'approved' | 'rejected' | 'expired' | 'needs_manual_review'
          conversation_state?: 'needs_trainer' | 'needs_name' | 'needs_email' | 'needs_preferences' | 'ready_for_approval' | 'awaiting_trainer_reply'
          summary_for_trainer?: string | null
          last_inbound_message_id?: string | null
          last_outbound_message_id?: string | null
          approved_user_id?: string | null
          approved_client_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          raw_phone?: string
          normalized_phone?: string
          requested_trainer_name_raw?: string | null
          requested_trainer_id?: string | null
          client_name?: string | null
          email?: string | null
          scheduling_preferences_text?: string | null
          scheduling_preferences_json?: Json
          status?: 'collecting_info' | 'awaiting_trainer_approval' | 'approved' | 'rejected' | 'expired' | 'needs_manual_review'
          conversation_state?: 'needs_trainer' | 'needs_name' | 'needs_email' | 'needs_preferences' | 'ready_for_approval' | 'awaiting_trainer_reply'
          summary_for_trainer?: string | null
          last_inbound_message_id?: string | null
          last_outbound_message_id?: string | null
          approved_user_id?: string | null
          approved_client_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      sms_trainer_approval_requests: {
        Row: {
          id: string
          lead_id: string
          trainer_id: string
          request_code: string
          status: 'pending' | 'approved' | 'rejected' | 'expired'
          outbound_message_id: string | null
          decision_message_id: string | null
          decided_at: string | null
          expires_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          lead_id: string
          trainer_id: string
          request_code: string
          status?: 'pending' | 'approved' | 'rejected' | 'expired'
          outbound_message_id?: string | null
          decision_message_id?: string | null
          decided_at?: string | null
          expires_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          lead_id?: string
          trainer_id?: string
          request_code?: string
          status?: 'pending' | 'approved' | 'rejected' | 'expired'
          outbound_message_id?: string | null
          decision_message_id?: string | null
          decided_at?: string | null
          expires_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      session_changes: {
        Row: {
          id: string
          session_id: string
          changed_by: string
          change_type: string
          old_values: Json | null
          new_values: Json | null
          reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          session_id: string
          changed_by: string
          change_type: string
          old_values?: Json | null
          new_values?: Json | null
          reason?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          session_id?: string
          changed_by?: string
          change_type?: string
          old_values?: Json | null
          new_values?: Json | null
          reason?: string | null
          created_at?: string
        }
      }
      payments: {
        Row: {
          id: string
          session_id: string | null
          client_id: string
          trainer_id: string
          amount: number
          status: 'pending' | 'paid' | 'failed' | 'refunded'
          stripe_payment_intent_id: string | null
          stripe_charge_id: string | null
          payment_method: string | null
          paid_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          session_id?: string | null
          client_id: string
          trainer_id: string
          amount: number
          status?: 'pending' | 'paid' | 'failed' | 'refunded'
          stripe_payment_intent_id?: string | null
          stripe_charge_id?: string | null
          payment_method?: string | null
          paid_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          session_id?: string | null
          client_id?: string
          trainer_id?: string
          amount?: number
          status?: 'pending' | 'paid' | 'failed' | 'refunded'
          stripe_payment_intent_id?: string | null
          stripe_charge_id?: string | null
          payment_method?: string | null
          paid_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      notification_preferences: {
        Row: {
          id: string
          user_id: string
          email_reminders: boolean
          sms_reminders: boolean
          reminder_hours_before: number
          cancellation_notifications: boolean
          payment_notifications: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          email_reminders?: boolean
          sms_reminders?: boolean
          reminder_hours_before?: number
          cancellation_notifications?: boolean
          payment_notifications?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          email_reminders?: boolean
          sms_reminders?: boolean
          reminder_hours_before?: number
          cancellation_notifications?: boolean
          payment_notifications?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      availability_templates: {
        Row: {
          id: string
          trainer_id: string
          day_of_week: number
          start_time: string
          end_time: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          trainer_id: string
          day_of_week: number
          start_time: string
          end_time: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          trainer_id?: string
          day_of_week?: number
          start_time?: string
          end_time?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      blocked_time_slots: {
        Row: {
          id: string
          trainer_id: string | null
          gym_space_id: string | null
          start_time: string
          end_time: string
          reason: string | null
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          trainer_id?: string | null
          gym_space_id?: string | null
          start_time: string
          end_time: string
          reason?: string | null
          created_by: string
          created_at?: string
        }
        Update: {
          id?: string
          trainer_id?: string | null
          gym_space_id?: string | null
          start_time?: string
          end_time?: string
          reason?: string | null
          created_by?: string
          created_at?: string
        }
      }
      sms_webhook_idempotency: {
        Row: {
          id: string
          provider: string
          event_key: string
          from_phone: string | null
          status: 'received' | 'processed' | 'failed'
          error_message: string | null
          created_at: string
          processed_at: string | null
        }
        Insert: {
          id?: string
          provider: string
          event_key: string
          from_phone?: string | null
          status?: 'received' | 'processed' | 'failed'
          error_message?: string | null
          created_at?: string
          processed_at?: string | null
        }
        Update: {
          id?: string
          provider?: string
          event_key?: string
          from_phone?: string | null
          status?: 'received' | 'processed' | 'failed'
          error_message?: string | null
          created_at?: string
          processed_at?: string | null
        }
      }
      sms_messages: {
        Row: {
          id: string
          provider: string
          audience: 'client' | 'trainer'
          message_kind: 'conversation' | 'book' | 'reschedule' | 'cancel'
          direction: 'inbound' | 'outbound'
          status: 'received' | 'queued' | 'sent' | 'delivered' | 'failed'
          message_sid: string | null
          account_sid: string | null
          from_phone: string
          to_phone: string
          normalized_from_phone: string
          normalized_to_phone: string
          body: string
          error_message: string | null
          offer_set_id: string | null
          client_id: string | null
          trainer_id: string | null
          source_change_id: string | null
          sent_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          provider?: string
          audience?: 'client' | 'trainer'
          message_kind?: 'conversation' | 'book' | 'reschedule' | 'cancel'
          direction: 'inbound' | 'outbound'
          status?: 'received' | 'queued' | 'sent' | 'delivered' | 'failed'
          message_sid?: string | null
          account_sid?: string | null
          from_phone: string
          to_phone: string
          normalized_from_phone: string
          normalized_to_phone: string
          body: string
          error_message?: string | null
          offer_set_id?: string | null
          client_id?: string | null
          trainer_id?: string | null
          source_change_id?: string | null
          sent_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          provider?: string
          audience?: 'client' | 'trainer'
          message_kind?: 'conversation' | 'book' | 'reschedule' | 'cancel'
          direction?: 'inbound' | 'outbound'
          status?: 'received' | 'queued' | 'sent' | 'delivered' | 'failed'
          message_sid?: string | null
          account_sid?: string | null
          from_phone?: string
          to_phone?: string
          normalized_from_phone?: string
          normalized_to_phone?: string
          body?: string
          error_message?: string | null
          offer_set_id?: string | null
          client_id?: string | null
          trainer_id?: string | null
          source_change_id?: string | null
          sent_at?: string | null
          created_at?: string
        }
      }
      sms_booking_offers: {
        Row: {
          id: string
          offer_set_id: string
          client_id: string
          trainer_id: string
          offered_by_message_id: string | null
          selected_by_message_id: string | null
          booked_session_id: string | null
          flow_type: string
          target_session_id: string | null
          slot_position: number
          slot_starts_at: string
          slot_ends_at: string
          time_zone: string
          status: 'pending' | 'booked' | 'expired' | 'conflicted'
          expires_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          offer_set_id: string
          client_id: string
          trainer_id: string
          offered_by_message_id?: string | null
          selected_by_message_id?: string | null
          booked_session_id?: string | null
          flow_type?: string
          target_session_id?: string | null
          slot_position: number
          slot_starts_at: string
          slot_ends_at: string
          time_zone: string
          status?: 'pending' | 'booked' | 'expired' | 'conflicted'
          expires_at: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          offer_set_id?: string
          client_id?: string
          trainer_id?: string
          offered_by_message_id?: string | null
          selected_by_message_id?: string | null
          booked_session_id?: string | null
          flow_type?: string
          target_session_id?: string | null
          slot_position?: number
          slot_starts_at?: string
          slot_ends_at?: string
          time_zone?: string
          status?: 'pending' | 'booked' | 'expired' | 'conflicted'
          expires_at?: string
          created_at?: string
          updated_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      user_role: 'trainer' | 'client' | 'admin'
      session_status: 'scheduled' | 'completed' | 'cancelled' | 'no_show'
      payment_status: 'pending' | 'paid' | 'failed' | 'refunded'
      gym_area: 'weights' | 'cardio' | 'studio' | 'pool' | 'outdoor'
      sms_direction: 'inbound' | 'outbound'
      sms_message_status: 'received' | 'queued' | 'sent' | 'delivered' | 'failed'
      sms_message_audience: 'client' | 'trainer'
      sms_message_kind: 'conversation' | 'book' | 'reschedule' | 'cancel'
      sms_offer_status: 'pending' | 'booked' | 'expired' | 'conflicted'
      sms_webhook_status: 'received' | 'processed' | 'failed'
      sms_intake_status:
        | 'collecting_info'
        | 'awaiting_trainer_approval'
        | 'approved'
        | 'rejected'
        | 'expired'
        | 'needs_manual_review'
      sms_intake_conversation_state:
        | 'needs_trainer'
        | 'needs_name'
        | 'needs_email'
        | 'needs_preferences'
        | 'ready_for_approval'
        | 'awaiting_trainer_reply'
      sms_trainer_approval_status: 'pending' | 'approved' | 'rejected' | 'expired'
    }
  }
}

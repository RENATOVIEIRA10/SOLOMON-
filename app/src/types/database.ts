export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alerts: {
        Row: {
          broker_id: string | null
          created_at: string
          id: string
          message: string
          read: boolean
          source_url: string | null
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          broker_id?: string | null
          created_at?: string
          id?: string
          message: string
          read?: boolean
          source_url?: string | null
          title: string
          type: string
          updated_at?: string
        }
        Update: {
          broker_id?: string | null
          created_at?: string
          id?: string
          message?: string
          read?: boolean
          source_url?: string | null
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          id: string
          new_data: Json | null
          old_data: Json | null
          record_id: string
          table_name: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id: string
          table_name: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      broker_clients: {
        Row: {
          birth_date: string | null
          broker_id: string
          cpf: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          birth_date?: string | null
          broker_id: string
          cpf?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          birth_date?: string | null
          broker_id?: string
          cpf?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "broker_clients_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
        ]
      }
      brokers: {
        Row: {
          active: boolean
          auth_user_id: string
          cpf: string | null
          created_at: string
          creci: string | null
          email: string | null
          id: string
          name: string
          phone: string
          plan: string
          plan_expires_at: string | null
          plan_started_at: string | null
          queries_reset_at: string | null
          queries_today: number
          susep_number: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          auth_user_id: string
          cpf?: string | null
          created_at?: string
          creci?: string | null
          email?: string | null
          id?: string
          name: string
          phone: string
          plan?: string
          plan_expires_at?: string | null
          plan_started_at?: string | null
          queries_reset_at?: string | null
          queries_today?: number
          susep_number?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          auth_user_id?: string
          cpf?: string | null
          created_at?: string
          creci?: string | null
          email?: string | null
          id?: string
          name?: string
          phone?: string
          plan?: string
          plan_expires_at?: string | null
          plan_started_at?: string | null
          queries_reset_at?: string | null
          queries_today?: number
          susep_number?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      claim_analyses: {
        Row: {
          broker_client_id: string | null
          broker_id: string
          checklist: Json | null
          created_at: string
          event_description: string | null
          event_type: string
          id: string
          policy_start_date: string | null
          product_id: string | null
          risk_flags: Json | null
          sources: Json | null
          updated_at: string
          verdict: string
          verdict_reason: string | null
        }
        Insert: {
          broker_client_id?: string | null
          broker_id: string
          checklist?: Json | null
          created_at?: string
          event_description?: string | null
          event_type: string
          id?: string
          policy_start_date?: string | null
          product_id?: string | null
          risk_flags?: Json | null
          sources?: Json | null
          updated_at?: string
          verdict: string
          verdict_reason?: string | null
        }
        Update: {
          broker_client_id?: string | null
          broker_id?: string
          checklist?: Json | null
          created_at?: string
          event_description?: string | null
          event_type?: string
          id?: string
          policy_start_date?: string | null
          product_id?: string | null
          risk_flags?: Json | null
          sources?: Json | null
          updated_at?: string
          verdict?: string
          verdict_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claim_analyses_broker_client_id_fkey"
            columns: ["broker_client_id"]
            isOneToOne: false
            referencedRelation: "broker_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_analyses_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_analyses_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_feedback: {
        Row: {
          broker_id: string
          channel: string
          comment: string | null
          conversation_id: string
          created_at: string
          flagged_issue: string | null
          id: string
          rating: number
        }
        Insert: {
          broker_id: string
          channel?: string
          comment?: string | null
          conversation_id: string
          created_at?: string
          flagged_issue?: string | null
          id?: string
          rating: number
        }
        Update: {
          broker_id?: string
          channel?: string
          comment?: string | null
          conversation_id?: string
          created_at?: string
          flagged_issue?: string | null
          id?: string
          rating?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversation_feedback_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_feedback_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          broker_id: string
          channel: string
          created_at: string
          id: string
          latency_ms: number | null
          message: string
          model: string | null
          response: string | null
          sources: Json | null
          tokens_used: number | null
          updated_at: string
        }
        Insert: {
          broker_id: string
          channel: string
          created_at?: string
          id?: string
          latency_ms?: number | null
          message: string
          model?: string | null
          response?: string | null
          sources?: Json | null
          tokens_used?: number | null
          updated_at?: string
        }
        Update: {
          broker_id?: string
          channel?: string
          created_at?: string
          id?: string
          latency_ms?: number | null
          message?: string
          model?: string | null
          response?: string | null
          sources?: Json | null
          tokens_used?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
        ]
      }
      coverages: {
        Row: {
          created_at: string
          details: Json | null
          excluded_risks: string[] | null
          grace_period_days: number | null
          id: string
          max_value: number | null
          min_value: number | null
          product_id: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          details?: Json | null
          excluded_risks?: string[] | null
          grace_period_days?: number | null
          id?: string
          max_value?: number | null
          min_value?: number | null
          product_id: string
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          details?: Json | null
          excluded_risks?: string[] | null
          grace_period_days?: number | null
          id?: string
          max_value?: number | null
          min_value?: number | null
          product_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coverages_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          chunk_index: number
          content: string
          content_hash: string
          created_at: string
          embedding: string | null
          id: string
          insurer_id: string | null
          metadata: Json | null
          product_id: string | null
          source_type: string
          source_url: string | null
          updated_at: string
        }
        Insert: {
          chunk_index?: number
          content: string
          content_hash: string
          created_at?: string
          embedding?: string | null
          id?: string
          insurer_id?: string | null
          metadata?: Json | null
          product_id?: string | null
          source_type: string
          source_url?: string | null
          updated_at?: string
        }
        Update: {
          chunk_index?: number
          content?: string
          content_hash?: string
          created_at?: string
          embedding?: string | null
          id?: string
          insurer_id?: string | null
          metadata?: Json | null
          product_id?: string | null
          source_type?: string
          source_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_insurer_id_fkey"
            columns: ["insurer_id"]
            isOneToOne: false
            referencedRelation: "insurers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          created_at: string
          endpoint: string
          expires_at: string
          id: string
          key: string
          response: Json | null
        }
        Insert: {
          created_at?: string
          endpoint: string
          expires_at?: string
          id?: string
          key: string
          response?: Json | null
        }
        Update: {
          created_at?: string
          endpoint?: string
          expires_at?: string
          id?: string
          key?: string
          response?: Json | null
        }
        Relationships: []
      }
      ingestion_logs: {
        Row: {
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          records_new: number
          records_processed: number
          records_updated: number
          source: string
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          records_new?: number
          records_processed?: number
          records_updated?: number
          source: string
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          records_new?: number
          records_processed?: number
          records_updated?: number
          source?: string
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      insurers: {
        Row: {
          active: boolean
          cnpj: string
          created_at: string
          id: string
          logo_url: string | null
          name: string
          opin_endpoint: string | null
          source: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          cnpj: string
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          opin_endpoint?: string | null
          source: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          cnpj?: string
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          opin_endpoint?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      policies: {
        Row: {
          beneficiaries: Json | null
          broker_client_id: string
          broker_id: string
          capital: number | null
          created_at: string
          end_date: string | null
          health_declaration: Json | null
          id: string
          insurer_id: string
          monthly_premium: number | null
          parsed_data: Json | null
          policy_number: string | null
          product_id: string
          raw_file_url: string | null
          start_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          beneficiaries?: Json | null
          broker_client_id: string
          broker_id: string
          capital?: number | null
          created_at?: string
          end_date?: string | null
          health_declaration?: Json | null
          id?: string
          insurer_id: string
          monthly_premium?: number | null
          parsed_data?: Json | null
          policy_number?: string | null
          product_id: string
          raw_file_url?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          beneficiaries?: Json | null
          broker_client_id?: string
          broker_id?: string
          capital?: number | null
          created_at?: string
          end_date?: string | null
          health_declaration?: Json | null
          id?: string
          insurer_id?: string
          monthly_premium?: number | null
          parsed_data?: Json | null
          policy_number?: string | null
          product_id?: string
          raw_file_url?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "policies_broker_client_id_fkey"
            columns: ["broker_client_id"]
            isOneToOne: false
            referencedRelation: "broker_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_insurer_id_fkey"
            columns: ["insurer_id"]
            isOneToOne: false
            referencedRelation: "insurers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_tables: {
        Row: {
          age_max: number
          age_min: number
          capital_max: number
          capital_min: number
          commission_rate: number | null
          created_at: string
          id: string
          insurer_id: string
          monthly_premium: number
          product_code: string
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          age_max: number
          age_min: number
          capital_max: number
          capital_min: number
          commission_rate?: number | null
          created_at?: string
          id?: string
          insurer_id: string
          monthly_premium: number
          product_code: string
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          age_max?: number
          age_min?: number
          capital_max?: number
          capital_min?: number
          commission_rate?: number | null
          created_at?: string
          id?: string
          insurer_id?: string
          monthly_premium?: number
          product_code?: string
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_tables_insurer_id_fkey"
            columns: ["insurer_id"]
            isOneToOne: false
            referencedRelation: "insurers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_tables_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          category: string | null
          code: string | null
          created_at: string
          id: string
          insurer_id: string
          modality: string
          name: string
          raw_data: Json | null
          susep_process: string | null
          terms_url: string | null
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          category?: string | null
          code?: string | null
          created_at?: string
          id?: string
          insurer_id: string
          modality: string
          name: string
          raw_data?: Json | null
          susep_process?: string | null
          terms_url?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          category?: string | null
          code?: string | null
          created_at?: string
          id?: string
          insurer_id?: string
          modality?: string
          name?: string
          raw_data?: Json | null
          susep_process?: string | null
          terms_url?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "products_insurer_id_fkey"
            columns: ["insurer_id"]
            isOneToOne: false
            referencedRelation: "insurers"
            referencedColumns: ["id"]
          },
        ]
      }
      proposals: {
        Row: {
          broker_client_id: string | null
          broker_id: string
          created_at: string
          id: string
          pdf_url: string | null
          sent_at: string | null
          sent_via: string | null
          simulation_id: string | null
          status: string
          updated_at: string
          viewed_at: string | null
        }
        Insert: {
          broker_client_id?: string | null
          broker_id: string
          created_at?: string
          id?: string
          pdf_url?: string | null
          sent_at?: string | null
          sent_via?: string | null
          simulation_id?: string | null
          status?: string
          updated_at?: string
          viewed_at?: string | null
        }
        Update: {
          broker_client_id?: string | null
          broker_id?: string
          created_at?: string
          id?: string
          pdf_url?: string | null
          sent_at?: string | null
          sent_via?: string | null
          simulation_id?: string | null
          status?: string
          updated_at?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proposals_broker_client_id_fkey"
            columns: ["broker_client_id"]
            isOneToOne: false
            referencedRelation: "broker_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_simulation_id_fkey"
            columns: ["simulation_id"]
            isOneToOne: false
            referencedRelation: "simulations"
            referencedColumns: ["id"]
          },
        ]
      }
      simulations: {
        Row: {
          broker_id: string
          created_at: string
          id: string
          input_data: Json | null
          plan_a: Json | null
          plan_b: Json | null
          result_data: Json | null
          type: string
          updated_at: string
        }
        Insert: {
          broker_id: string
          created_at?: string
          id?: string
          input_data?: Json | null
          plan_a?: Json | null
          plan_b?: Json | null
          result_data?: Json | null
          type: string
          updated_at?: string
        }
        Update: {
          broker_id?: string
          created_at?: string
          id?: string
          input_data?: Json | null
          plan_a?: Json | null
          plan_b?: Json | null
          result_data?: Json | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "simulations_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_events: {
        Row: {
          broker_id: string
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          new_plan: string | null
          old_plan: string | null
          updated_at: string
        }
        Insert: {
          broker_id: string
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          new_plan?: string | null
          old_plan?: string | null
          updated_at?: string
        }
        Update: {
          broker_id?: string
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          new_plan?: string | null
          old_plan?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_events_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_broker_id: { Args: never; Returns: string }
      match_documents: {
        Args: {
          filter_insurer_id?: string
          filter_product_id?: string
          filter_source_type?: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          content: string
          id: string
          insurer_id: string
          metadata: Json
          product_id: string
          similarity: number
          source_type: string
          source_url: string
        }[]
      }
      search_products: {
        Args: { max_results?: number; search_query: string }
        Returns: {
          coverage_summary: string
          insurer_id: string
          insurer_name: string
          modality: string
          product_code: string
          product_id: string
          product_name: string
          susep_process: string
          terms_url: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

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
      billing_events: {
        Row: {
          broker_id: string | null
          created_at: string
          event_type: string
          id: string
          payload: Json | null
        }
        Insert: {
          broker_id?: string | null
          created_at?: string
          event_type: string
          id: string
          payload?: Json | null
        }
        Update: {
          broker_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
        ]
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
          asaas_customer_id: string | null
          asaas_subscription_id: string | null
          auth_user_id: string
          billing_status: string | null
          billing_updated_at: string | null
          cpf: string | null
          created_at: string
          creci: string | null
          email: string | null
          id: string
          name: string
          overdue_since: string | null
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
          asaas_customer_id?: string | null
          asaas_subscription_id?: string | null
          auth_user_id: string
          billing_status?: string | null
          billing_updated_at?: string | null
          cpf?: string | null
          created_at?: string
          creci?: string | null
          email?: string | null
          id?: string
          name: string
          overdue_since?: string | null
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
          asaas_customer_id?: string | null
          asaas_subscription_id?: string | null
          auth_user_id?: string
          billing_status?: string | null
          billing_updated_at?: string | null
          cpf?: string | null
          created_at?: string
          creci?: string | null
          email?: string | null
          id?: string
          name?: string
          overdue_since?: string | null
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
      brokers_welcome: {
        Row: {
          broker_id: string
          sent_at: string
        }
        Insert: {
          broker_id: string
          sent_at?: string
        }
        Update: {
          broker_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brokers_welcome_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: true
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
        ]
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
          confidence_score: number | null
          created_at: string
          id: string
          latency_ms: number | null
          low_confidence: boolean
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
          confidence_score?: number | null
          created_at?: string
          id?: string
          latency_ms?: number | null
          low_confidence?: boolean
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
          confidence_score?: number | null
          created_at?: string
          id?: string
          latency_ms?: number | null
          low_confidence?: boolean
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
      corpus_routing: {
        Row: {
          insurer_name: string
          mode: string
          mode_set_at: string
          mode_set_by: string
          notes: string | null
        }
        Insert: {
          insurer_name: string
          mode?: string
          mode_set_at?: string
          mode_set_by: string
          notes?: string | null
        }
        Update: {
          insurer_name?: string
          mode?: string
          mode_set_at?: string
          mode_set_by?: string
          notes?: string | null
        }
        Relationships: []
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
      document_toc: {
        Row: {
          created_at: string
          end_page: number
          id: string
          insurer_id: string
          product_id: string | null
          section_path: string
          section_title: string
          source_doc: string
          start_page: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_page: number
          id?: string
          insurer_id: string
          product_id?: string | null
          section_path: string
          section_title: string
          source_doc: string
          start_page: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_page?: number
          id?: string
          insurer_id?: string
          product_id?: string | null
          section_path?: string
          section_title?: string
          source_doc?: string
          start_page?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_toc_insurer_id_fkey"
            columns: ["insurer_id"]
            isOneToOne: false
            referencedRelation: "insurers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_toc_product_id_fkey"
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
          pdf_hash: string | null
          product_id: string | null
          source_type: string
          source_url: string | null
          superseded_by: string | null
          updated_at: string
          valid_from: string
          valid_until: string | null
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
          pdf_hash?: string | null
          product_id?: string | null
          source_type: string
          source_url?: string | null
          superseded_by?: string | null
          updated_at?: string
          valid_from?: string
          valid_until?: string | null
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
          pdf_hash?: string | null
          product_id?: string | null
          source_type?: string
          source_url?: string | null
          superseded_by?: string | null
          updated_at?: string
          valid_from?: string
          valid_until?: string | null
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
          {
            foreignKeyName: "documents_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents_deleted_non_life: {
        Row: {
          chunk_index: number | null
          content: string | null
          content_hash: string | null
          delete_reason: string | null
          deleted_at: string | null
          id: string
          insurer_id: string | null
          metadata: Json | null
          source_type: string | null
          source_url: string | null
        }
        Insert: {
          chunk_index?: number | null
          content?: string | null
          content_hash?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          id: string
          insurer_id?: string | null
          metadata?: Json | null
          source_type?: string | null
          source_url?: string | null
        }
        Update: {
          chunk_index?: number | null
          content?: string | null
          content_hash?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          id?: string
          insurer_id?: string | null
          metadata?: Json | null
          source_type?: string | null
          source_url?: string | null
        }
        Relationships: []
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
      insurer_rate_tables: {
        Row: {
          age: number
          coverage_type: string
          gender: string
          id: number
          imported_at: string
          insurer_id: string
          period: string | null
          portfolio: string | null
          product_code: string
          product_name: string
          rate: number
          rate_unit: string
          source_doc_name: string
          source_page: number | null
          version_label: string | null
        }
        Insert: {
          age: number
          coverage_type?: string
          gender: string
          id?: number
          imported_at?: string
          insurer_id: string
          period?: string | null
          portfolio?: string | null
          product_code: string
          product_name: string
          rate: number
          rate_unit?: string
          source_doc_name: string
          source_page?: number | null
          version_label?: string | null
        }
        Update: {
          age?: number
          coverage_type?: string
          gender?: string
          id?: number
          imported_at?: string
          insurer_id?: string
          period?: string | null
          portfolio?: string | null
          product_code?: string
          product_name?: string
          rate?: number
          rate_unit?: string
          source_doc_name?: string
          source_page?: number | null
          version_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insurer_rate_tables_insurer_id_fkey"
            columns: ["insurer_id"]
            isOneToOne: false
            referencedRelation: "insurers"
            referencedColumns: ["id"]
          },
        ]
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
      pdf_version_detected: {
        Row: {
          detected_at: string | null
          detected_date: string | null
          detected_yyyymm: number | null
          extraction_method: string | null
          insurer_name: string | null
          raw_hints: string | null
          source_url: string
        }
        Insert: {
          detected_at?: string | null
          detected_date?: string | null
          detected_yyyymm?: number | null
          extraction_method?: string | null
          insurer_name?: string | null
          raw_hints?: string | null
          source_url: string
        }
        Update: {
          detected_at?: string | null
          detected_date?: string | null
          detected_yyyymm?: number | null
          extraction_method?: string | null
          insurer_name?: string | null
          raw_hints?: string | null
          source_url?: string
        }
        Relationships: []
      }
      pending_crawl_queue: {
        Row: {
          added_at: string | null
          detected_date: string | null
          id: string
          insurer_name: string | null
          notes: string | null
          priority: string | null
          processed_at: string | null
          product_hint: string | null
          source_url: string
          status: string | null
        }
        Insert: {
          added_at?: string | null
          detected_date?: string | null
          id?: string
          insurer_name?: string | null
          notes?: string | null
          priority?: string | null
          processed_at?: string | null
          product_hint?: string | null
          source_url: string
          status?: string | null
        }
        Update: {
          added_at?: string | null
          detected_date?: string | null
          id?: string
          insurer_name?: string | null
          notes?: string | null
          priority?: string | null
          processed_at?: string | null
          product_hint?: string | null
          source_url?: string
          status?: string | null
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
      rag_cleaner_runs: {
        Row: {
          batch_size: number
          documents_processed: number | null
          errors: number | null
          finished_at: string | null
          id: string
          notes: string | null
          started_at: string | null
          suggestions_created: number | null
        }
        Insert: {
          batch_size: number
          documents_processed?: number | null
          errors?: number | null
          finished_at?: string | null
          id?: string
          notes?: string | null
          started_at?: string | null
          suggestions_created?: number | null
        }
        Update: {
          batch_size?: number
          documents_processed?: number | null
          errors?: number | null
          finished_at?: string | null
          id?: string
          notes?: string | null
          started_at?: string | null
          suggestions_created?: number | null
        }
        Relationships: []
      }
      rag_cleaner_suggestions: {
        Row: {
          content_hash: string | null
          created_at: string | null
          description: string | null
          document_id: string | null
          id: string
          issue_type: string
          reviewed_at: string | null
          reviewed_by: string | null
          run_id: string
          severity: string | null
          status: string | null
          suggested_action: string | null
          suggested_metadata: Json | null
        }
        Insert: {
          content_hash?: string | null
          created_at?: string | null
          description?: string | null
          document_id?: string | null
          id?: string
          issue_type: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id: string
          severity?: string | null
          status?: string | null
          suggested_action?: string | null
          suggested_metadata?: Json | null
        }
        Update: {
          content_hash?: string | null
          created_at?: string | null
          description?: string | null
          document_id?: string | null
          id?: string
          issue_type?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id?: string
          severity?: string | null
          status?: string | null
          suggested_action?: string | null
          suggested_metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "rag_cleaner_suggestions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      retrieval_traces: {
        Row: {
          chunks_returned: number
          corpus: string
          fallback_reason: string | null
          fallback_used: boolean
          id: number
          insurer_name: string | null
          latency_ms: number
          mode: string
          request_id: string
          rerank_used: boolean
          source: string
          ts: string
          user_question_hash: string | null
        }
        Insert: {
          chunks_returned: number
          corpus: string
          fallback_reason?: string | null
          fallback_used?: boolean
          id?: number
          insurer_name?: string | null
          latency_ms: number
          mode?: string
          request_id: string
          rerank_used?: boolean
          source: string
          ts?: string
          user_question_hash?: string | null
        }
        Update: {
          chunks_returned?: number
          corpus?: string
          fallback_reason?: string | null
          fallback_used?: boolean
          id?: number
          insurer_name?: string | null
          latency_ms?: number
          mode?: string
          request_id?: string
          rerank_used?: boolean
          source?: string
          ts?: string
          user_question_hash?: string | null
        }
        Relationships: []
      }
      sales_leads: {
        Row: {
          company: string
          created_at: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          score: number | null
          source: string
        }
        Insert: {
          company: string
          created_at?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          score?: number | null
          source?: string
        }
        Update: {
          company?: string
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          score?: number | null
          source?: string
        }
        Relationships: []
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
      product_analytics_events: {
        Row: {
          auth_user_id: string | null
          broker_id: string | null
          created_at: string
          event_name: string
          id: string
          properties: Json
          source: string
        }
        Insert: {
          auth_user_id?: string | null
          broker_id?: string | null
          created_at?: string
          event_name: string
          id?: string
          properties?: Json
          source?: string
        }
        Update: {
          auth_user_id?: string | null
          broker_id?: string | null
          created_at?: string
          event_name?: string
          id?: string
          properties?: Json
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_analytics_events_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_sessions: {
        Row: {
          broker_id: string | null
          created_at: string
          last_insurer: string | null
          last_intent: string | null
          last_product: string | null
          messages: Json
          phone: string
          updated_at: string
        }
        Insert: {
          broker_id?: string | null
          created_at?: string
          last_insurer?: string | null
          last_intent?: string | null
          last_product?: string | null
          messages?: Json
          phone: string
          updated_at?: string
        }
        Update: {
          broker_id?: string | null
          created_at?: string
          last_insurer?: string | null
          last_intent?: string | null
          last_product?: string | null
          messages?: Json
          phone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_sessions_broker_id_fkey"
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
      fetch_chunks_by_toc: {
        Args: {
          filter_insurer_id: string
          filter_product_id: string
          section_query: string
        }
        Returns: {
          content: string
          id: string
          insurer_id: string
          metadata: Json
          product_id: string
          source_type: string
          source_url: string
        }[]
      }
      get_broker_activity_summary: { Args: never; Returns: Json }
      get_broker_id: { Args: never; Returns: string }
      get_pdfs_sem_data_detectada: {
        Args: { p_limit?: number }
        Returns: {
          source_url: string
        }[]
      }
      increment_broker_queries: {
        Args: { p_broker_id: string }
        Returns: number
      }
      match_documents: {
        Args: {
          filter_exclude_non_life?: boolean
          filter_insurer_id?: string
          filter_product_id?: string
          filter_source_type?: string
          filter_tipo_produto?: string
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
      match_shadow_documents: {
        Args: {
          filter_exclude_non_life?: boolean
          filter_insurer_id?: string
          filter_product_id?: string
          filter_source_type?: string
          filter_tipo_produto?: string
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
      supersede_document_versions: {
        Args: { p_insurer_id: string; p_source_url: string }
        Returns: number
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

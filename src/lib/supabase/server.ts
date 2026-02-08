// Supabase client for server-side operations
import { createClient } from "@supabase/supabase-js";

// Server-side Supabase client with service role (for admin operations)
export function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// Regular Supabase client for server components
export function createServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseAnonKey);
}

// Database types (will be generated from schema)
export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          role: "free" | "pro" | "enterprise" | "admin";
          created_at: string;
          updated_at: string;
          last_login: string | null;
        };
        Insert: {
          id?: string;
          email: string;
          full_name?: string | null;
          role?: "free" | "pro" | "enterprise" | "admin";
        };
        Update: {
          email?: string;
          full_name?: string | null;
          role?: "free" | "pro" | "enterprise" | "admin";
          last_login?: string | null;
        };
      };
      documents: {
        Row: {
          id: string;
          user_id: string;
          title: string | null;
          original_filename: string;
          file_type: string;
          file_size: number;
          storage_path: string;
          document_type: string | null;
          jurisdiction: string | null;
          legal_category: string | null;
          urgency_level: string | null;
          status: "pending" | "processing" | "completed" | "failed";
          processed_at: string | null;
          raw_text: string | null;
          summary: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title?: string | null;
          original_filename: string;
          file_type: string;
          file_size: number;
          storage_path: string;
        };
        Update: {
          title?: string | null;
          document_type?: string | null;
          jurisdiction?: string | null;
          legal_category?: string | null;
          urgency_level?: string | null;
          status?: "pending" | "processing" | "completed" | "failed";
          processed_at?: string | null;
          raw_text?: string | null;
          summary?: string | null;
        };
      };
      document_chunks: {
        Row: {
          id: string;
          document_id: string;
          chunk_index: number;
          content: string;
          metadata: Record<string, unknown>;
          vector_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          document_id: string;
          chunk_index: number;
          content: string;
          metadata?: Record<string, unknown>;
          vector_id?: string | null;
        };
        Update: {
          content?: string;
          metadata?: Record<string, unknown>;
          vector_id?: string | null;
        };
      };
      queries: {
        Row: {
          id: string;
          user_id: string;
          document_id: string | null;
          query_text: string;
          response_text: string | null;
          citations: Record<string, unknown>[] | null;
          confidence_score: number | null;
          tokens_used: number | null;
          processing_time_ms: number | null;
          feedback: "helpful" | "not_helpful" | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          document_id?: string | null;
          query_text: string;
        };
        Update: {
          response_text?: string | null;
          citations?: Record<string, unknown>[] | null;
          confidence_score?: number | null;
          tokens_used?: number | null;
          processing_time_ms?: number | null;
          feedback?: "helpful" | "not_helpful" | null;
        };
      };
      usage_tracking: {
        Row: {
          id: string;
          user_id: string;
          action_type: "document_upload" | "query" | "analysis";
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          action_type: "document_upload" | "query" | "analysis";
          metadata?: Record<string, unknown>;
        };
        Update: never;
      };
    };
  };
};

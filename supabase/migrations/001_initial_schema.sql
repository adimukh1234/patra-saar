-- PatraSaar Database Schema Migration
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================================
-- Users Table (extends Supabase auth.users)
-- =========================================
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'free' CHECK (role IN ('free', 'pro', 'enterprise', 'admin')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ
);

-- =========================================
-- Documents Table
-- =========================================
CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    title VARCHAR(500),
    original_filename VARCHAR(500) NOT NULL,
    file_type VARCHAR(50) NOT NULL,
    file_size INTEGER NOT NULL,
    storage_path VARCHAR(1000) NOT NULL,
    
    -- Classification
    document_type VARCHAR(100), -- contract, fir, judgment, notice, policy
    jurisdiction VARCHAR(100),  -- central, state name
    legal_category VARCHAR(100), -- civil, criminal
    urgency_level VARCHAR(50) CHECK (urgency_level IN ('high', 'medium', 'low')),
    
    -- Processing Status
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    processed_at TIMESTAMPTZ,
    
    -- Extracted Content
    raw_text TEXT,
    summary TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================
-- Document Chunks Table
-- =========================================
CREATE TABLE IF NOT EXISTS public.document_chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    vector_id VARCHAR(255), -- Reference to vector DB
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================
-- Document Clauses Table (for contracts/notices)
-- =========================================
CREATE TABLE IF NOT EXISTS public.document_clauses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    clause_number VARCHAR(50),
    clause_title VARCHAR(500),
    original_text TEXT,
    simplified_text TEXT,
    risk_level VARCHAR(50) CHECK (risk_level IN ('high', 'medium', 'low', 'none')),
    obligations JSONB DEFAULT '[]', -- Array of obligation strings
    rights JSONB DEFAULT '[]',      -- Array of rights strings
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================
-- Queries Table
-- =========================================
CREATE TABLE IF NOT EXISTS public.queries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
    query_text TEXT NOT NULL,
    response_text TEXT,
    citations JSONB DEFAULT '[]',
    confidence_score DECIMAL(3,2),
    tokens_used INTEGER,
    processing_time_ms INTEGER,
    feedback VARCHAR(50) CHECK (feedback IN ('helpful', 'not_helpful')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================
-- Usage Tracking Table
-- =========================================
CREATE TABLE IF NOT EXISTS public.usage_tracking (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    action_type VARCHAR(50) NOT NULL CHECK (action_type IN ('document_upload', 'query', 'analysis')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================
-- Audit Logs Table
-- =========================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100),
    resource_id UUID,
    ip_address VARCHAR(50),
    user_agent TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================
-- Indexes for Performance
-- =========================================
CREATE INDEX IF NOT EXISTS idx_documents_user ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON public.documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_created ON public.documents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_chunks_document ON public.document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_queries_user ON public.queries(user_id);
CREATE INDEX IF NOT EXISTS idx_queries_document ON public.queries(document_id);
CREATE INDEX IF NOT EXISTS idx_queries_created ON public.queries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_user ON public.usage_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_action ON public.usage_tracking(action_type);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_created ON public.usage_tracking(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON public.audit_logs(user_id);

-- =========================================
-- Row Level Security (RLS)
-- =========================================

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_clauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Users: Can only access own profile
CREATE POLICY "Users can view own profile" ON public.users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.users
    FOR UPDATE USING (auth.uid() = id);

-- Documents: Can only access own documents
CREATE POLICY "Users can view own documents" ON public.documents
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own documents" ON public.documents
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own documents" ON public.documents
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own documents" ON public.documents
    FOR DELETE USING (auth.uid() = user_id);

-- Document Chunks: Access through document ownership
CREATE POLICY "Users can view own document chunks" ON public.document_chunks
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.documents 
            WHERE documents.id = document_chunks.document_id 
            AND documents.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert own document chunks" ON public.document_chunks
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.documents 
            WHERE documents.id = document_chunks.document_id 
            AND documents.user_id = auth.uid()
        )
    );

-- Document Clauses: Access through document ownership
CREATE POLICY "Users can view own document clauses" ON public.document_clauses
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.documents 
            WHERE documents.id = document_clauses.document_id 
            AND documents.user_id = auth.uid()
        )
    );

-- Queries: Can only access own queries
CREATE POLICY "Users can view own queries" ON public.queries
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own queries" ON public.queries
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Usage Tracking: Can only view own usage
CREATE POLICY "Users can view own usage" ON public.usage_tracking
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own usage" ON public.usage_tracking
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Audit Logs: Users can view their own logs
CREATE POLICY "Users can view own audit logs" ON public.audit_logs
    FOR SELECT USING (auth.uid() = user_id);

-- =========================================
-- Function: Auto-create user profile on signup
-- =========================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, full_name)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', NULL)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create user profile
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================
-- Function: Update timestamp on changes
-- =========================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_documents_updated_at
    BEFORE UPDATE ON public.documents
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- =========================================
-- Storage Bucket Setup
-- =========================================
-- Run this separately in Supabase Dashboard > Storage

-- Create 'documents' bucket if not exists
-- Settings:
--   - Public: false
--   - File size limit: 5MB
--   - Allowed MIME types: application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, text/plain

-- Storage RLS policies (set up in Dashboard):
-- SELECT: auth.uid()::text = (storage.foldername(name))[1]
-- INSERT: auth.uid()::text = (storage.foldername(name))[1]
-- DELETE: auth.uid()::text = (storage.foldername(name))[1]

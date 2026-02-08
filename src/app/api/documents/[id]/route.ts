// Document Analysis API Route - Get detailed document analysis
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { llmService } from "@/lib/llm";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Get document details and analysis
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id: documentId } = await params;
    const supabase = createServerClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch document with chunks
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError || !document) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      );
    }

    // Fetch chunks for the document
    const { data: chunks } = await supabase
      .from("document_chunks")
      .select("*")
      .eq("document_id", documentId)
      .order("chunk_index", { ascending: true });

    // Fetch clauses if available
    const { data: clauses } = await supabase
      .from("document_clauses")
      .select("*")
      .eq("document_id", documentId)
      .order("clause_number", { ascending: true });

    return NextResponse.json({
      document: {
        id: document.id,
        title: document.title,
        originalFilename: document.original_filename,
        fileType: document.file_type,
        fileSize: document.file_size,
        status: document.status,
        documentType: document.document_type,
        jurisdiction: document.jurisdiction,
        legalCategory: document.legal_category,
        urgencyLevel: document.urgency_level,
        summary: document.summary,
        createdAt: document.created_at,
        processedAt: document.processed_at,
      },
      chunks: chunks?.map((c) => ({
        id: c.id,
        chunkIndex: c.chunk_index,
        content: c.content,
        metadata: c.metadata,
      })),
      clauses: clauses?.map((c) => ({
        id: c.id,
        clauseNumber: c.clause_number,
        clauseTitle: c.clause_title,
        originalText: c.original_text,
        simplifiedText: c.simplified_text,
        riskLevel: c.risk_level,
        obligations: c.obligations,
        rights: c.rights,
      })),
    });
  } catch (error) {
    console.error("Document detail error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Delete document
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id: documentId } = await params;
    const supabase = createServerClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify ownership
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("id, storage_path")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError || !document) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      );
    }

    // Delete from storage
    if (document.storage_path) {
      await supabase.storage
        .from("documents")
        .remove([document.storage_path]);
    }

    // Delete from database (cascades to chunks and clauses)
    const { error: deleteError } = await supabase
      .from("documents")
      .delete()
      .eq("id", documentId);

    if (deleteError) {
      console.error("Delete error:", deleteError);
      return NextResponse.json(
        { error: "Failed to delete document" },
        { status: 500 }
      );
    }

    // Delete vectors from Qdrant
    const { ragPipeline } = await import("@/lib/rag/pipeline");
    await ragPipeline.deleteDocument(documentId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete document error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

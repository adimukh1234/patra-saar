// Query API Route - RAG-powered legal question answering
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { ragPipeline } from "@/lib/rag/pipeline";
import { z } from "zod";

// Request validation schema
const querySchema = z.object({
  query: z.string().min(1).max(2000),
  documentId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();

    // Get current user from session
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check usage limits
    const currentMonth = new Date().toISOString().slice(0, 7);
    const { count } = await supabase
      .from("usage_tracking")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("action_type", "query")
      .gte("created_at", `${currentMonth}-01`);

    const MONTHLY_LIMIT = 50;
    if ((count || 0) >= MONTHLY_LIMIT) {
      return NextResponse.json(
        {
          error: "Monthly query limit reached",
          limit: MONTHLY_LIMIT,
          used: count,
        },
        { status: 429 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validation = querySchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validation.error.issues },
        { status: 400 }
      );
    }

    const { query, documentId } = validation.data;

    // If documentId provided, verify user owns the document
    if (documentId) {
      const { data: doc, error: docError } = await supabase
        .from("documents")
        .select("id, status")
        .eq("id", documentId)
        .eq("user_id", user.id)
        .single();

      if (docError || !doc) {
        return NextResponse.json(
          { error: "Document not found" },
          { status: 404 }
        );
      }

      if (doc.status !== "completed") {
        return NextResponse.json(
          { error: "Document is still processing" },
          { status: 400 }
        );
      }
    }

    // Execute RAG query
    const result = await ragPipeline.query(user.id, query, { documentId });

    return NextResponse.json({
      answer: result.answer,
      citations: result.citations,
      confidence: result.confidence,
      processingTimeMs: result.processingTimeMs,
      disclaimer:
        "⚠️ This is for informational purposes only and does not constitute legal advice.",
    });
  } catch (error) {
    console.error("Query error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Get query history
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const documentId = searchParams.get("documentId");
    const offset = (page - 1) * limit;

    let query = supabase
      .from("queries")
      .select("*", { count: "exact" })
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (documentId) {
      query = query.eq("document_id", documentId);
    }

    const { data: queries, error, count } = await query;

    if (error) {
      console.error("Fetch queries error:", error);
      return NextResponse.json(
        { error: "Failed to fetch queries" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      queries,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    console.error("GET queries error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

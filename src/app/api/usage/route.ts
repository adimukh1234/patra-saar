// Usage Statistics API Route
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

// Monthly limits for free tier
const LIMITS = {
  documents: 10,
  queries: 50,
  storageMB: 50,
};

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

    const currentMonth = new Date().toISOString().slice(0, 7);
    const monthStart = `${currentMonth}-01`;

    // Count document uploads this month
    const { count: documentsUsed } = await supabase
      .from("usage_tracking")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("action_type", "document_upload")
      .gte("created_at", monthStart);

    // Count queries this month
    const { count: queriesUsed } = await supabase
      .from("usage_tracking")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("action_type", "query")
      .gte("created_at", monthStart);

    // Calculate total storage used
    const { data: documents } = await supabase
      .from("documents")
      .select("file_size")
      .eq("user_id", user.id);

    const storageUsedBytes =
      documents?.reduce((sum, doc) => sum + (doc.file_size || 0), 0) || 0;
    const storageUsedMB = Math.round((storageUsedBytes / (1024 * 1024)) * 100) / 100;

    // Calculate reset date (first day of next month)
    const now = new Date();
    const resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    return NextResponse.json({
      usage: {
        documents: {
          used: documentsUsed || 0,
          limit: LIMITS.documents,
          remaining: LIMITS.documents - (documentsUsed || 0),
        },
        queries: {
          used: queriesUsed || 0,
          limit: LIMITS.queries,
          remaining: LIMITS.queries - (queriesUsed || 0),
        },
        storage: {
          usedMB: storageUsedMB,
          limitMB: LIMITS.storageMB,
          remainingMB: Math.max(0, LIMITS.storageMB - storageUsedMB),
        },
      },
      resetDate: resetDate.toISOString(),
      period: currentMonth,
    });
  } catch (error) {
    console.error("Usage API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

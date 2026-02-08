// Document Upload API Route
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { ragPipeline } from "@/lib/rag/pipeline";
import { v4 as uuidv4 } from "uuid";

// Max file size: 5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Supported file types
const SUPPORTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
];

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
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const { count } = await supabase
      .from("usage_tracking")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("action_type", "document_upload")
      .gte("created_at", `${currentMonth}-01`);

    const MONTHLY_LIMIT = 10;
    if ((count || 0) >= MONTHLY_LIMIT) {
      return NextResponse.json(
        {
          error: "Monthly upload limit reached",
          limit: MONTHLY_LIMIT,
          used: count,
        },
        { status: 429 }
      );
    }

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const title = formData.get("title") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    if (!SUPPORTED_TYPES.includes(file.type)) {
      return NextResponse.json(
        {
          error: "Unsupported file type",
          supported: ["PDF", "DOCX", "TXT"],
        },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: "File too large",
          maxSizeMB: MAX_FILE_SIZE / (1024 * 1024),
        },
        { status: 400 }
      );
    }

    // Generate document ID and storage path
    const documentId = uuidv4();
    const fileExtension = file.name.split(".").pop() || "pdf";
    const storagePath = `${user.id}/${documentId}.${fileExtension}`;

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload file to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return NextResponse.json(
        { error: "Failed to upload file" },
        { status: 500 }
      );
    }

    // Create document record
    const { error: insertError } = await supabase.from("documents").insert({
      id: documentId,
      user_id: user.id,
      title: title || file.name,
      original_filename: file.name,
      file_type: fileExtension,
      file_size: file.size,
      storage_path: storagePath,
      status: "pending",
    });

    if (insertError) {
      console.error("Database insert error:", insertError);
      // Clean up uploaded file
      await supabase.storage.from("documents").remove([storagePath]);
      return NextResponse.json(
        { error: "Failed to create document record" },
        { status: 500 }
      );
    }

    // Process document asynchronously (in production, use a queue)
    // For now, we'll process inline but return immediately
    ragPipeline
      .ingestDocument(documentId, user.id, buffer, file.type, file.name)
      .catch((err) => console.error("Background processing error:", err));

    return NextResponse.json({
      documentId,
      status: "processing",
      message: "Document uploaded successfully. Processing in background.",
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Get list of user's documents
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

    // Parse query params
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "10");
    const status = searchParams.get("status");
    const offset = (page - 1) * limit;

    // Build query
    let query = supabase
      .from("documents")
      .select("*", { count: "exact" })
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq("status", status);
    }

    const { data: documents, error, count } = await query;

    if (error) {
      console.error("Fetch documents error:", error);
      return NextResponse.json(
        { error: "Failed to fetch documents" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      documents,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    console.error("GET documents error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

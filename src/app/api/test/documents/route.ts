// Test Document Upload API (NO AUTH - Development Only)
import { NextRequest, NextResponse } from "next/server";
import { documentProcessor } from "@/lib/documents/processor";
import { embeddingService } from "@/lib/embeddings";
import { vectorService } from "@/lib/vector";
import { v4 as uuidv4 } from "uuid";

// In-memory store for test documents
const testDocuments = new Map<string, {
  id: string;
  title: string;
  chunks: Array<{ id: string; content: string; embedding: number[] }>;
  rawText: string;
  createdAt: Date;
}>();

// Max file size: 5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  // Only allow in development
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const title = formData.get("title") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 400 });
    }

    console.log(`[TEST] Processing file: ${file.name} (${file.size} bytes)`);

    // Get file extension
    const ext = file.name.split(".").pop()?.toLowerCase() || "txt";
    
    // Read file contents
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Extract text
    console.log("[TEST] Extracting text...");
    const extracted = await documentProcessor.extractText(buffer, ext, file.name);
    
    if (!extracted.text || extracted.text.length < 50) {
      return NextResponse.json({ 
        error: "Could not extract enough text from document",
        extracted: extracted.text?.length || 0
      }, { status: 400 });
    }

    console.log(`[TEST] Extracted ${extracted.text.length} characters`);

    // Normalize and chunk
    const normalizedText = documentProcessor.normalizeText(extracted.text);
    const chunks = documentProcessor.chunkDocument(normalizedText);
    
    console.log(`[TEST] Created ${chunks.length} chunks`);

    // Generate embeddings
    console.log("[TEST] Generating embeddings...");
    const embeddings = await embeddingService.embedBatch(
      chunks.map(c => c.content)
    );

    // Create document record
    const documentId = uuidv4();
    
    // Store in memory
    const docChunks = chunks.map((chunk, i) => ({
      id: chunk.id,
      content: chunk.content,
      embedding: embeddings[i],
    }));

    testDocuments.set(documentId, {
      id: documentId,
      title: title || file.name,
      chunks: docChunks,
      rawText: normalizedText.slice(0, 10000),
      createdAt: new Date(),
    });

    // Also store in Qdrant for real vector search
    try {
      const vectorDocs = chunks.map((chunk, i) => ({
        id: chunk.id,
        content: chunk.content,
        embedding: embeddings[i],
        metadata: {
          documentId,
          userId: "test-user",
          chunkIndex: i,
          section: chunk.metadata.section,
        },
      }));
      
      await vectorService.upsertVectors(vectorDocs);
      console.log("[TEST] Stored vectors in Qdrant");
    } catch (err) {
      console.log("[TEST] Qdrant storage failed, using in-memory only:", err);
    }

    console.log(`[TEST] Document ${documentId} ready!`);

    return NextResponse.json({
      documentId,
      status: "completed",
      title: title || file.name,
      chunks: chunks.length,
      textLength: normalizedText.length,
    });
  } catch (error) {
    console.error("[TEST] Upload error:", error);
    return NextResponse.json(
      { error: `Processing failed: ${error}` },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Return list of test documents
  const docs = Array.from(testDocuments.values()).map(d => ({
    id: d.id,
    title: d.title,
    chunks: d.chunks.length,
    createdAt: d.createdAt,
  }));
  
  return NextResponse.json({ documents: docs });
}

// Export for use in query route
export { testDocuments };

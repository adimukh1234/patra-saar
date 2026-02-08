// Test Query API (NO AUTH - Development Only)
import { NextRequest, NextResponse } from "next/server";
import { embeddingService } from "@/lib/embeddings";
import { vectorService } from "@/lib/vector";
import { llmService } from "@/lib/llm";

// Simple in-memory document store for testing
const testDocuments = new Map<string, {
  id: string;
  title: string;
  chunks: Array<{ id: string; content: string; embedding: number[] }>;
  rawText: string;
}>();

export async function POST(request: NextRequest) {
  // Only allow in development
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { query, documentId } = body;

    if (!query || typeof query !== "string") {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    console.log(`[TEST] Query: "${query}"`);

    // Generate query embedding
    console.log("[TEST] Generating query embedding...");
    const queryEmbedding = await embeddingService.embed(query);

    // Search Qdrant for relevant chunks
    let relevantChunks: Array<{ content: string; score: number; section?: string }> = [];

    try {
      const searchResults = await vectorService.search(queryEmbedding, {
        limit: 5,
        filter: documentId ? { documentId } : undefined,
      });

      relevantChunks = searchResults.map((r) => ({
        content: r.content,
        score: r.score,
        section: r.metadata?.section,
      }));

      console.log(`[TEST] Found ${relevantChunks.length} relevant chunks from Qdrant`);
    } catch (err) {
      console.log("[TEST] Qdrant search failed:", err);
      
      // Fallback: search in-memory documents using cosine similarity
      if (testDocuments.size > 0) {
        const allChunks: Array<{ content: string; embedding: number[]; docId: string }> = [];
        
        for (const [docId, doc] of testDocuments) {
          if (!documentId || docId === documentId) {
            for (const chunk of doc.chunks) {
              allChunks.push({ ...chunk, docId });
            }
          }
        }

        // Calculate similarity
        const withScores = allChunks.map((chunk) => ({
          content: chunk.content,
          score: cosineSimilarity(queryEmbedding, chunk.embedding),
        }));

        // Sort by score and take top 5
        relevantChunks = withScores
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);

        console.log(`[TEST] Found ${relevantChunks.length} chunks from in-memory search`);
      }
    }

    if (relevantChunks.length === 0) {
      return NextResponse.json({
        answer: "I couldn't find any relevant information in the uploaded documents. Please upload a document first and try again.",
        citations: [],
        confidence: 0,
      });
    }

    // Build context from relevant chunks
    const context = relevantChunks
      .map((c, i) => `[${i + 1}] ${c.content}`)
      .join("\n\n");

    console.log("[TEST] Calling LLM...");

    // Generate answer using LLM
    const answer = await llmService.answerWithContext(query, context);

    console.log("[TEST] Answer generated!");

    // Create citations
    const citations = relevantChunks.slice(0, 3).map((c, i) => ({
      id: i + 1,
      content: c.content.slice(0, 200) + (c.content.length > 200 ? "..." : ""),
      section: c.section || `Source ${i + 1}`,
      relevance: Math.round(c.score * 100),
    }));

    return NextResponse.json({
      answer,
      citations,
      confidence: relevantChunks[0]?.score || 0,
      disclaimer: "⚠️ This is AI-generated content for informational purposes only. Not legal advice.",
    });
  } catch (error) {
    console.error("[TEST] Query error:", error);
    return NextResponse.json(
      { error: `Query failed: ${error}` },
      { status: 500 }
    );
  }
}

// Cosine similarity helper
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

// Export for document route to use
export { testDocuments };

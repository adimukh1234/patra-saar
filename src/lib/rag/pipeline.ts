// RAG Pipeline - Orchestrates document ingestion and query processing
import { documentProcessor, DocumentChunk } from "../documents/processor";
import { embeddingService } from "../embeddings";
import { vectorService, SearchResult } from "../vector";
import { llmService, LLMResponse } from "../llm";
import { createServiceClient } from "../supabase/server";

export interface RAGQueryResult {
  answer: string;
  citations: Citation[];
  confidence: number;
  tokensUsed: number;
  processingTimeMs: number;
}

export interface Citation {
  source: string;
  section?: string;
  content: string;
  relevanceScore: number;
}

export interface DocumentIngestionResult {
  documentId: string;
  chunksCreated: number;
  status: "completed" | "failed";
  error?: string;
}

class RAGPipeline {
  // Ingest a document into the vector store
  async ingestDocument(
    documentId: string,
    userId: string,
    fileBuffer: Buffer,
    fileType: string,
    filename: string
  ): Promise<DocumentIngestionResult> {
    const startTime = Date.now();
    const supabase = createServiceClient();

    try {
      // Update status to processing
      await supabase
        .from("documents")
        .update({ status: "processing" })
        .eq("id", documentId);

      // 1. Extract text from document
      const processed = await documentProcessor.extractText(
        fileBuffer,
        fileType,
        filename
      );

      // 2. Normalize text
      const normalizedText = documentProcessor.normalizeText(processed.text);

      // 3. Chunk the document (legal-aware)
      const chunks = documentProcessor.chunkDocument(normalizedText);

      if (chunks.length === 0) {
        throw new Error("No text could be extracted from document");
      }

      // 4. Generate embeddings for each chunk
      const chunkTexts = chunks.map((c) => c.content);
      const embeddings = await embeddingService.embedBatch(chunkTexts);

      // 5. Store chunks in PostgreSQL
      const chunkRecords = chunks.map((chunk, i) => ({
        id: chunk.id,
        document_id: documentId,
        chunk_index: i,
        content: chunk.content,
        metadata: chunk.metadata,
        vector_id: chunk.id,
      }));

      await supabase.from("document_chunks").insert(chunkRecords);

      // 6. Store vectors in Qdrant
      const vectorDocs = chunks.map((chunk, i) => ({
        id: chunk.id,
        content: chunk.content,
        embedding: embeddings[i],
        metadata: {
          documentId,
          userId,
          chunkIndex: i,
          section: chunk.metadata.section,
          pageNumber: chunk.metadata.pageNumber,
        },
      }));

      await vectorService.upsertVectors(vectorDocs);

      // 7. Generate initial summary using LLM
      const summaryResponse = await llmService.chat([
        {
          role: "system",
          content: "You are a legal document summarizer. Provide a concise 2-3 paragraph summary of the following legal document, highlighting key points, parties involved, and important dates or obligations.",
        },
        {
          role: "user",
          content: `Summarize this legal document:\n\n${normalizedText.slice(0, 8000)}${normalizedText.length > 8000 ? "..." : ""}`,
        },
      ]);

      // 8. Update document with extracted data
      await supabase
        .from("documents")
        .update({
          status: "completed",
          raw_text: normalizedText,
          summary: summaryResponse.content,
          processed_at: new Date().toISOString(),
        })
        .eq("id", documentId);

      // 9. Track usage
      await supabase.from("usage_tracking").insert({
        user_id: userId,
        action_type: "document_upload",
        metadata: {
          documentId,
          chunksCreated: chunks.length,
          processingTimeMs: Date.now() - startTime,
        },
      });

      return {
        documentId,
        chunksCreated: chunks.length,
        status: "completed",
      };
    } catch (error) {
      console.error("Document ingestion error:", error);

      // Update status to failed
      await supabase
        .from("documents")
        .update({ status: "failed" })
        .eq("id", documentId);

      return {
        documentId,
        chunksCreated: 0,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // Process a user query (RAG)
  async query(
    userId: string,
    queryText: string,
    options: {
      documentId?: string;
      topK?: number;
    } = {}
  ): Promise<RAGQueryResult> {
    const startTime = Date.now();
    const { documentId, topK = 5 } = options;

    try {
      // 1. Generate query embedding
      const queryEmbedding = await embeddingService.embed(queryText);

      // 2. Search vector store
      const searchResults = await vectorService.search(queryEmbedding, {
        limit: topK,
        filter: documentId ? { documentId } : { userId },
      });

      if (searchResults.length === 0) {
        return {
          answer:
            "I couldn't find relevant information to answer your question. Please try rephrasing or ensure you have uploaded relevant documents.\n\n⚠️ This is for informational purposes only, not legal advice.",
          citations: [],
          confidence: 0,
          tokensUsed: 0,
          processingTimeMs: Date.now() - startTime,
        };
      }

      // 3. Build context from search results
      const context = this.buildContext(searchResults);
      const citations = this.extractCitations(searchResults);

      // 4. Get document title if specific document
      let documentTitle: string | undefined;
      if (documentId) {
        const supabase = createServiceClient();
        const { data } = await supabase
          .from("documents")
          .select("title, original_filename")
          .eq("id", documentId)
          .single();
        documentTitle = data?.title || data?.original_filename;
      }

      // 5. Generate answer with LLM
      const llmResponse = await llmService.answerWithContext(
        context,
        queryText,
        documentTitle
      );

      // 6. Calculate confidence based on search scores
      const avgScore =
        searchResults.reduce((sum, r) => sum + r.score, 0) / searchResults.length;
      const confidence = Math.min(avgScore, 1);

      // 7. Store query in database
      const supabase = createServiceClient();
      await supabase.from("queries").insert({
        user_id: userId,
        document_id: documentId || null,
        query_text: queryText,
        response_text: llmResponse.content,
        citations: citations as unknown as Record<string, unknown>[],
        confidence_score: confidence,
        tokens_used: llmResponse.tokensUsed,
        processing_time_ms: Date.now() - startTime,
      });

      // 8. Track usage
      await supabase.from("usage_tracking").insert({
        user_id: userId,
        action_type: "query",
        metadata: {
          documentId,
          queryLength: queryText.length,
          resultsCount: searchResults.length,
        },
      });

      return {
        answer: llmResponse.content,
        citations,
        confidence,
        tokensUsed: llmResponse.tokensUsed,
        processingTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      console.error("RAG query error:", error);
      throw error;
    }
  }

  private buildContext(results: SearchResult[]): string {
    return results
      .map((r, i) => {
        const sectionInfo = r.metadata.section
          ? ` (${r.metadata.section})`
          : "";
        return `[Source ${i + 1}${sectionInfo}]:\n${r.content}`;
      })
      .join("\n\n---\n\n");
  }

  private extractCitations(results: SearchResult[]): Citation[] {
    return results.map((r) => ({
      source: r.metadata.documentId,
      section: r.metadata.section,
      content: r.content.slice(0, 200) + (r.content.length > 200 ? "..." : ""),
      relevanceScore: r.score,
    }));
  }

  // Delete all vectors for a document
  async deleteDocument(documentId: string): Promise<void> {
    await vectorService.deleteByDocumentId(documentId);
  }
}

export const ragPipeline = new RAGPipeline();

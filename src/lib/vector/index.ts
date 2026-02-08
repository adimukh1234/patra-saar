// Qdrant Vector Database Service
import { QdrantClient } from "@qdrant/js-client-rest";

export interface VectorDocument {
  id: string;
  content: string;
  embedding: number[];
  metadata: {
    documentId: string;
    userId: string;
    chunkIndex: number;
    documentType?: string;
    section?: string;
    pageNumber?: number;
    isCorpus?: boolean;
  };
}

export interface SearchResult {
  id: string;
  content: string;
  score: number;
  metadata: VectorDocument["metadata"];
}

class VectorService {
  private client: QdrantClient | null = null;
  private collectionName: string;
  private vectorDimension = 384; // all-MiniLM-L6-v2 dimension

  constructor() {
    this.collectionName =
      process.env.QDRANT_COLLECTION_NAME || "patrasaar_legal_docs";

    if (process.env.QDRANT_URL && process.env.QDRANT_API_KEY) {
      this.client = new QdrantClient({
        url: process.env.QDRANT_URL,
        apiKey: process.env.QDRANT_API_KEY,
      });
    }
  }

  async initialize(): Promise<void> {
    if (!this.client) {
      console.warn("Qdrant client not configured");
      return;
    }

    try {
      // Check if collection exists
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(
        (c) => c.name === this.collectionName
      );

      if (!exists) {
        // Create collection with cosine similarity
        await this.client.createCollection(this.collectionName, {
          vectors: {
            size: this.vectorDimension,
            distance: "Cosine",
          },
        });
        console.log(`Created Qdrant collection: ${this.collectionName}`);
      }
    } catch (error) {
      console.error("Failed to initialize Qdrant:", error);
      throw error;
    }
  }

  async upsertVectors(documents: VectorDocument[]): Promise<void> {
    if (!this.client) {
      throw new Error("Qdrant client not configured");
    }

    // Ensure collection exists
    await this.initialize();

    const points = documents.map((doc) => ({
      id: doc.id,
      vector: doc.embedding,
      payload: {
        content: doc.content,
        ...doc.metadata,
      },
    }));

    await this.client.upsert(this.collectionName, {
      wait: true,
      points,
    });
  }

  async search(
    queryEmbedding: number[],
    options: {
      limit?: number;
      filter?: {
        documentId?: string;
        userId?: string;
        documentType?: string;
      };
    } = {}
  ): Promise<SearchResult[]> {
    if (!this.client) {
      throw new Error("Qdrant client not configured");
    }

    // Ensure collection exists
    await this.initialize();

    const { limit = 5, filter } = options;

    // Build filter conditions
    const filterConditions: Array<{
      key: string;
      match: { value: string };
    }> = [];

    if (filter?.documentId) {
      filterConditions.push({
        key: "documentId",
        match: { value: filter.documentId },
      });
    }
    if (filter?.userId) {
      filterConditions.push({
        key: "userId",
        match: { value: filter.userId },
      });
    }
    if (filter?.documentType) {
      filterConditions.push({
        key: "documentType",
        match: { value: filter.documentType },
      });
    }

    const searchResult = await this.client.search(this.collectionName, {
      vector: queryEmbedding,
      limit,
      filter:
        filterConditions.length > 0
          ? { must: filterConditions }
          : undefined,
      with_payload: true,
    });

    return searchResult.map((result) => ({
      id: result.id as string,
      content: (result.payload?.content as string) || "",
      score: result.score,
      metadata: {
        documentId: (result.payload?.documentId as string) || "",
        userId: (result.payload?.userId as string) || "",
        chunkIndex: (result.payload?.chunkIndex as number) || 0,
        documentType: result.payload?.documentType as string | undefined,
        section: result.payload?.section as string | undefined,
        pageNumber: result.payload?.pageNumber as number | undefined,
        isCorpus: result.payload?.isCorpus as boolean | undefined,
      },
    }));
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    if (!this.client) {
      throw new Error("Qdrant client not configured");
    }

    await this.client.delete(this.collectionName, {
      filter: {
        must: [
          {
            key: "documentId",
            match: { value: documentId },
          },
        ],
      },
    });
  }

  async deleteByUserId(userId: string): Promise<void> {
    if (!this.client) {
      throw new Error("Qdrant client not configured");
    }

    await this.client.delete(this.collectionName, {
      filter: {
        must: [
          {
            key: "userId",
            match: { value: userId },
          },
        ],
      },
    });
  }
}

// Export singleton instance
export const vectorService = new VectorService();

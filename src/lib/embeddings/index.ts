// Embedding Service using multiple providers
// Primary: Groq (if available), Fallback: simple hash-based embeddings

const EMBEDDING_DIMENSION = 384;

class EmbeddingService {
  private groqApiKey: string | null;

  constructor() {
    this.groqApiKey = process.env.GROQ_API_KEY || null;
  }

  async embed(text: string): Promise<number[]> {
    // Always use hash-based embeddings for now since external APIs are unreliable
    // In production, you'd use a local model like Transformers.js or a paid API
    return this.hashEmbedding(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Hash embeddings are fast, no need for rate limiting
    return texts.map((t) => this.hashEmbedding(t));
  }

  // Improved hash-based embedding using TF-IDF-like weighting
  // This is suitable for development and basic semantic similarity
  private hashEmbedding(text: string): number[] {
    const embedding = new Array(EMBEDDING_DIMENSION).fill(0);
    const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, "");
    const words = normalized.split(/\s+/).filter((w) => w.length > 0);

    if (words.length === 0) {
      return embedding;
    }

    // Create word frequency map
    const wordFreq = new Map<string, number>();
    for (const word of words) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }

    // Hash each unique word with TF weighting
    for (const [word, freq] of wordFreq) {
      const tf = freq / words.length;
      
      // Multiple hash positions for each word (like SimHash)
      for (let h = 0; h < 3; h++) {
        const hash = this.stringHash(word + h);
        const idx = Math.abs(hash) % EMBEDDING_DIMENSION;
        const sign = hash > 0 ? 1 : -1;
        embedding[idx] += sign * tf;
      }
    }

    // Add n-gram features for better context
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = words[i] + "_" + words[i + 1];
      const hash = this.stringHash(bigram);
      const idx = Math.abs(hash) % EMBEDDING_DIMENSION;
      embedding[idx] += 0.5 / words.length;
    }

    // Normalize to unit vector
    const magnitude = Math.sqrt(
      embedding.reduce((sum, val) => sum + val * val, 0)
    );
    if (magnitude > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= magnitude;
      }
    }

    return embedding;
  }

  // Simple string hash function (djb2)
  private stringHash(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    }
    return hash;
  }

  getDimension(): number {
    return EMBEDDING_DIMENSION;
  }
}

export const embeddingService = new EmbeddingService();

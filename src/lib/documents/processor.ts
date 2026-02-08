// Document Processing Service - Text extraction, OCR, and chunking
import { v4 as uuidv4 } from "uuid";

export interface ProcessedDocument {
  text: string;
  pages: number;
  metadata: {
    title?: string;
    author?: string;
    creationDate?: string;
  };
}

export interface DocumentChunk {
  id: string;
  content: string;
  chunkIndex: number;
  metadata: {
    section?: string;
    clauseNumber?: string;
    pageNumber?: number;
    startChar: number;
    endChar: number;
  };
}

// Legal section patterns for Indian documents
const SECTION_PATTERNS = [
  /^Section\s+(\d+[A-Za-z]?)/im,
  /^Article\s+(\d+)/im,
  /^Clause\s+(\d+(?:\.\d+)?)/im,
  /^Rule\s+(\d+)/im,
  /^Order\s+([IVXLCDM]+|\d+)/im,
  /^(?:^\d+)\.\s+([A-Z][^.]+)/m,
  /^(?:^[IVXLCDM]+)\.\s+/m,
  /^(?:\([a-z]\)|\([ivx]+\))/m,
];

// Type for pdf-parse result
interface PDFData {
  text: string;
  numpages: number;
  info?: {
    Title?: string;
    Author?: string;
    CreationDate?: string;
  };
}

class DocumentProcessor {
  private maxChunkSize = 500; // tokens (approx 2000 chars)
  private chunkOverlap = 50; // tokens overlap

  // Extract text from different file types
  async extractText(
    buffer: Buffer,
    fileType: string,
    filename: string
  ): Promise<ProcessedDocument> {
    switch (fileType.toLowerCase()) {
      case "pdf":
      case "application/pdf":
        return this.extractFromPDF(buffer);
      case "docx":
      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return this.extractFromDOCX(buffer);
      case "txt":
      case "text/plain":
        return {
          text: buffer.toString("utf-8"),
          pages: 1,
          metadata: { title: filename },
        };
      default:
        throw new Error(`Unsupported file type: ${fileType}`);
    }
  }

  private async extractFromPDF(buffer: Buffer): Promise<ProcessedDocument> {
    try {
      // Use pdf-parse with text-only options (no rendering)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require("pdf-parse");
      
      // Custom page render function that just extracts text
      const options = {
        // Disable rendering that requires DOMMatrix
        pagerender: function(pageData: { getTextContent: () => Promise<{ items: Array<{ str: string }> }> }) {
          return pageData.getTextContent()
            .then(function(textContent: { items: Array<{ str: string }> }) {
              let text = '';
              for (const item of textContent.items) {
                text += item.str + ' ';
              }
              return text;
            });
        }
      };
      
      const data = await pdfParse(buffer, options);
      
      return {
        text: data.text,
        pages: data.numpages,
        metadata: {
          title: data.info?.Title,
          author: data.info?.Author,
          creationDate: data.info?.CreationDate,
        },
      };
    } catch (error) {
      console.error("PDF extraction error:", error);
      
      // Fallback: Try to extract any text we can from the buffer
      try {
        const textContent = this.extractTextFromPDFBuffer(buffer);
        if (textContent && textContent.length > 50) {
          console.log("Using fallback PDF text extraction");
          return {
            text: textContent,
            pages: 1,
            metadata: {},
          };
        }
      } catch {
        // Ignore fallback errors
      }
      
      throw new Error("Failed to extract text from PDF. Try uploading a TXT or DOCX file instead.");
    }
  }
  
  // Simple fallback: extract readable text from PDF buffer
  private extractTextFromPDFBuffer(buffer: Buffer): string {
    const content = buffer.toString('latin1');
    const textMatches: string[] = [];
    
    // Look for text between BT (begin text) and ET (end text) markers
    const regex = /\(([^)]+)\)/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const text = match[1];
      // Filter out binary/control characters
      if (/^[\x20-\x7E\s]+$/.test(text) && text.length > 2) {
        textMatches.push(text);
      }
    }
    
    return textMatches.join(' ').replace(/\s+/g, ' ').trim();
  }

  private async extractFromDOCX(buffer: Buffer): Promise<ProcessedDocument> {
    try {
      // Dynamic import for ESM compatibility
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mammoth = require("mammoth") as { extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }> };
      const result = await mammoth.extractRawText({ buffer });
      return {
        text: result.value,
        pages: 1, // DOCX doesn't have page info without complex parsing
        metadata: {},
      };
    } catch (error) {
      console.error("DOCX extraction error:", error);
      throw new Error("Failed to extract text from DOCX");
    }
  }

  // Legal-aware text chunking
  chunkDocument(text: string): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const sections = this.identifySections(text);

    if (sections.length === 0) {
      // No clear sections, use sliding window
      return this.slidingWindowChunk(text);
    }

    // Process each section
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const sectionText = text.slice(section.start, section.end);

      if (this.estimateTokens(sectionText) <= this.maxChunkSize) {
        // Section fits in one chunk
        chunks.push({
          id: uuidv4(),
          content: sectionText.trim(),
          chunkIndex: chunks.length,
          metadata: {
            section: section.title,
            clauseNumber: section.clauseNumber,
            startChar: section.start,
            endChar: section.end,
          },
        });
      } else {
        // Section too large, split with overlap
        const subChunks = this.splitLargeSection(sectionText, section);
        for (const subChunk of subChunks) {
          chunks.push({
            ...subChunk,
            chunkIndex: chunks.length,
          });
        }
      }
    }

    return chunks;
  }

  private identifySections(
    text: string
  ): Array<{
    start: number;
    end: number;
    title?: string;
    clauseNumber?: string;
  }> {
    const sections: Array<{
      start: number;
      end: number;
      title?: string;
      clauseNumber?: string;
    }> = [];

    // Find all section boundaries
    const lines = text.split("\n");
    let currentPos = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const pattern of SECTION_PATTERNS) {
        const match = line.match(pattern);
        if (match) {
          // Close previous section
          if (sections.length > 0) {
            sections[sections.length - 1].end = currentPos;
          }

          // Start new section
          sections.push({
            start: currentPos,
            end: text.length,
            title: line.trim().slice(0, 100),
            clauseNumber: match[1],
          });
          break;
        }
      }

      currentPos += line.length + 1; // +1 for newline
    }

    return sections;
  }

  private splitLargeSection(
    sectionText: string,
    section: { title?: string; clauseNumber?: string; start: number }
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const sentences = this.splitIntoSentences(sectionText);
    let currentChunk = "";
    let chunkStart = section.start;

    for (const sentence of sentences) {
      const potentialChunk = currentChunk + sentence + " ";

      if (this.estimateTokens(potentialChunk) > this.maxChunkSize) {
        // Save current chunk and start new one
        if (currentChunk.trim()) {
          chunks.push({
            id: uuidv4(),
            content: currentChunk.trim(),
            chunkIndex: 0, // Will be set by caller
            metadata: {
              section: section.title,
              clauseNumber: section.clauseNumber,
              startChar: chunkStart,
              endChar: chunkStart + currentChunk.length,
            },
          });
        }

        // Start new chunk with overlap
        const overlapText = this.getOverlapText(currentChunk);
        currentChunk = overlapText + sentence + " ";
        chunkStart += currentChunk.length - overlapText.length - sentence.length - 1;
      } else {
        currentChunk = potentialChunk;
      }
    }

    // Add remaining chunk
    if (currentChunk.trim()) {
      chunks.push({
        id: uuidv4(),
        content: currentChunk.trim(),
        chunkIndex: 0,
        metadata: {
          section: section.title,
          clauseNumber: section.clauseNumber,
          startChar: chunkStart,
          endChar: section.start + sectionText.length,
        },
      });
    }

    return chunks;
  }

  private slidingWindowChunk(text: string): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const sentences = this.splitIntoSentences(text);
    let currentChunk = "";
    let chunkStart = 0;
    let currentStart = 0;

    for (const sentence of sentences) {
      const potentialChunk = currentChunk + sentence + " ";

      if (this.estimateTokens(potentialChunk) > this.maxChunkSize) {
        if (currentChunk.trim()) {
          chunks.push({
            id: uuidv4(),
            content: currentChunk.trim(),
            chunkIndex: chunks.length,
            metadata: {
              startChar: chunkStart,
              endChar: chunkStart + currentChunk.length,
            },
          });
        }

        const overlapText = this.getOverlapText(currentChunk);
        chunkStart = currentStart - overlapText.length;
        currentChunk = overlapText + sentence + " ";
      } else {
        currentChunk = potentialChunk;
      }
      currentStart += sentence.length + 1;
    }

    if (currentChunk.trim()) {
      chunks.push({
        id: uuidv4(),
        content: currentChunk.trim(),
        chunkIndex: chunks.length,
        metadata: {
          startChar: chunkStart,
          endChar: text.length,
        },
      });
    }

    return chunks;
  }

  private splitIntoSentences(text: string): string[] {
    // Handle Indian legal citation patterns
    return text
      .replace(/([.!?])\s+/g, "$1|||")
      .replace(/\|\|\|([A-Z])/g, "|||$1")
      .split("|||")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  private getOverlapText(text: string): string {
    const words = text.split(/\s+/);
    const overlapWords = words.slice(Math.max(0, words.length - this.chunkOverlap));
    return overlapWords.join(" ") + " ";
  }

  private estimateTokens(text: string): number {
    // Rough estimation: ~4 chars per token for English
    return Math.ceil(text.length / 4);
  }

  // Normalize and clean legal text
  normalizeText(text: string): string {
    return text
      // Fix common OCR errors in legal text
      .replace(/\bl\b/g, "I") // Common OCR error
      .replace(/\s+/g, " ") // Normalize whitespace
      .replace(/[""]/g, '"') // Normalize quotes
      .replace(/['']/g, "'")
      .replace(/–/g, "-")
      .replace(/…/g, "...")
      .trim();
  }
}

export const documentProcessor = new DocumentProcessor();

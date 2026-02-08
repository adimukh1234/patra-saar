// scripts/seed-knowledge-base.ts
// Populates the RAG knowledge base with legal documents
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";

// Load environment variables from .env.local
dotenv.config({ path: ".env.local" });

const KNOWLEDGE_BASE_DIR = "./knowledge_base";
const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

// Initialize Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface KnowledgeDoc {
  filePath: string;
  category: string;
  title: string;
}

async function main() {
  console.log("🚀 PatraSaar Knowledge Base Seeder\n");
  
  // Check if knowledge_base directory exists
  if (!fs.existsSync(KNOWLEDGE_BASE_DIR)) {
    console.log("📁 Creating knowledge_base directory structure...\n");
    fs.mkdirSync(path.join(KNOWLEDGE_BASE_DIR, "acts"), { recursive: true });
    fs.mkdirSync(path.join(KNOWLEDGE_BASE_DIR, "rules"), { recursive: true });
    fs.mkdirSync(path.join(KNOWLEDGE_BASE_DIR, "templates"), { recursive: true });
    fs.mkdirSync(path.join(KNOWLEDGE_BASE_DIR, "judgments"), { recursive: true });
    
    console.log("✅ Created folders:");
    console.log("   - knowledge_base/acts/");
    console.log("   - knowledge_base/rules/");
    console.log("   - knowledge_base/templates/");
    console.log("   - knowledge_base/judgments/\n");
    console.log("📌 Add your PDF/DOCX/TXT files to these folders and run again.\n");
    console.log("Suggested downloads:");
    console.log("   - IPC: https://indiacode.nic.in/handle/123456789/2263");
    console.log("   - CrPC: https://indiacode.nic.in/handle/123456789/1611");
    console.log("   - Contract Act: https://indiacode.nic.in/handle/123456789/2187\n");
    return;
  }
  
  // Discover documents
  const docs = discoverDocuments();
  
  if (docs.length === 0) {
    console.log("⚠️ No documents found in knowledge_base/");
    console.log("   Add PDF, DOCX, or TXT files to the subfolders.\n");
    return;
  }
  
  console.log(`Found ${docs.length} documents to process\n`);
  
  // Import processing modules dynamically
  const { documentProcessor } = await import("../src/lib/documents/processor");
  const { embeddingService } = await import("../src/lib/embeddings");
  const { vectorService } = await import("../src/lib/vector");
  
  let processed = 0;
  let failed = 0;
  
  for (const doc of docs) {
    try {
      console.log(`📄 [${processed + 1}/${docs.length}] ${doc.title}`);
      
      // Read file
      const buffer = fs.readFileSync(doc.filePath);
      const fileType = path.extname(doc.filePath).slice(1).toLowerCase();
      
      // Check if already exists
      const { data: existing } = await supabase
        .from("documents")
        .select("id")
        .eq("original_filename", path.basename(doc.filePath))
        .eq("user_id", SYSTEM_USER_ID)
        .single();
      
      if (existing) {
        console.log("   ⏭️ Already exists, skipping\n");
        processed++;
        continue;
      }
      
      // Extract text
      const extracted = await documentProcessor.extractText(
        buffer, 
        fileType, 
        doc.title
      );
      
      if (!extracted.text || extracted.text.length < 100) {
        console.log("   ⚠️ Insufficient text extracted, skipping\n");
        failed++;
        continue;
      }
      
      // Normalize and chunk
      const normalizedText = documentProcessor.normalizeText(extracted.text);
      const chunks = documentProcessor.chunkDocument(normalizedText);
      
      console.log(`   → Extracted ${normalizedText.length} chars`);
      console.log(`   → Created ${chunks.length} chunks`);
      
      // Generate embeddings
      console.log("   → Generating embeddings...");
      const embeddings = await embeddingService.embedBatch(
        chunks.map(c => c.content)
      );
      
      // Create document record
      const docId = uuidv4();
      
      const { error: docError } = await supabase.from("documents").insert({
        id: docId,
        user_id: SYSTEM_USER_ID,
        title: doc.title,
        original_filename: path.basename(doc.filePath),
        file_type: fileType,
        file_size: buffer.length,
        storage_path: `system/${doc.category}/${path.basename(doc.filePath)}`,
        document_type: doc.category,
        status: "completed",
        raw_text: normalizedText.slice(0, 100000), // Limit size
        processed_at: new Date().toISOString(),
      });
      
      if (docError) {
        throw new Error(`DB insert error: ${docError.message}`);
      }
      
      // Store chunks
      const chunkRecords = chunks.map((chunk, i) => ({
        id: chunk.id,
        document_id: docId,
        chunk_index: i,
        content: chunk.content,
        metadata: {
          ...chunk.metadata,
          category: doc.category,
          isSystem: true,
        },
        vector_id: chunk.id,
      }));
      
      await supabase.from("document_chunks").insert(chunkRecords);
      
      // Store in vector DB
      console.log("   → Storing vectors...");
      const vectorDocs = chunks.map((chunk, i) => ({
        id: chunk.id,
        content: chunk.content,
        embedding: embeddings[i],
        metadata: {
          documentId: docId,
          userId: SYSTEM_USER_ID,
          chunkIndex: i,
          section: chunk.metadata.section,
        },
      }));
      
      await vectorService.upsertVectors(vectorDocs);
      
      console.log("   ✅ Done\n");
      processed++;
      
      // Rate limiting - wait 1 second between documents
      await sleep(1000);
      
    } catch (error) {
      console.log(`   ❌ Error: ${error}\n`);
      failed++;
    }
  }
  
  console.log("═".repeat(50));
  console.log(`\n🎉 Seeding complete!`);
  console.log(`   ✅ Processed: ${processed}`);
  console.log(`   ❌ Failed: ${failed}\n`);
}

function discoverDocuments(): KnowledgeDoc[] {
  const docs: KnowledgeDoc[] = [];
  const validExtensions = [".pdf", ".docx", ".txt"];
  
  const categories = fs.readdirSync(KNOWLEDGE_BASE_DIR);
  
  for (const category of categories) {
    const categoryPath = path.join(KNOWLEDGE_BASE_DIR, category);
    
    if (!fs.statSync(categoryPath).isDirectory()) continue;
    
    const files = fs.readdirSync(categoryPath);
    
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (!validExtensions.includes(ext)) continue;
      
      docs.push({
        filePath: path.join(categoryPath, file),
        category,
        title: file.replace(ext, "").replace(/_/g, " ").replace(/-/g, " "),
      });
    }
  }
  
  return docs;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run
main().catch(console.error);

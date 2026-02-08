# PatraSaar Knowledge Base Guide

How to build and populate the RAG knowledge base with Indian legal documents.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Knowledge Base                           │
├─────────────────────────────────────────────────────────────┤
│  Qdrant Cloud          │  Supabase PostgreSQL               │
│  ─────────────         │  ────────────────────              │
│  Vector embeddings     │  Document metadata                 │
│  (384-dim MiniLM)      │  Text chunks                       │
│  Semantic search       │  Source references                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Sources for Indian Law

### 1. Free & Open Datasets

| Source | Content | Format | Link |
|--------|---------|--------|------|
| **Indian Kanoon** | Court judgments, Acts | HTML/PDF | [indiankanoon.org](https://indiankanoon.org) |
| **India Code** | Central Acts & Rules | PDF | [indiacode.nic.in](https://indiacode.nic.in) |
| **PRS Legislative** | Bills, summaries | PDF | [prsindia.org](https://prsindia.org) |
| **eCourts** | Case status, orders | PDF | [ecourts.gov.in](https://ecourts.gov.in) |
| **Bare Acts** | Law texts | PDF/TXT | Various publishers |

### 2. Key Legal Documents to Include

```
knowledge_base/
├── acts/
│   ├── indian_penal_code.pdf           # IPC - Criminal offenses
│   ├── code_of_criminal_procedure.pdf  # CrPC - Criminal procedures
│   ├── code_of_civil_procedure.pdf     # CPC - Civil procedures
│   ├── indian_contract_act.pdf         # Contract law
│   ├── indian_evidence_act.pdf         # Evidence rules
│   ├── consumer_protection_act.pdf     # Consumer rights
│   ├── information_technology_act.pdf  # Cyber law
│   └── right_to_information_act.pdf    # RTI
├── rules/
│   ├── motor_vehicles_rules.pdf
│   └── income_tax_rules.pdf
├── templates/
│   ├── fir_format.txt
│   ├── legal_notice_template.txt
│   └── rental_agreement_template.txt
└── judgments/
    ├── landmark_cases/
    └── recent_judgments/
```

---

## Step-by-Step: Building the Knowledge Base

### Step 1: Create the Seed Script

Create `scripts/seed-knowledge-base.ts`:

```typescript
// scripts/seed-knowledge-base.ts
import fs from "fs";
import path from "path";
import { documentProcessor } from "../src/lib/documents/processor";
import { embeddingService } from "../src/lib/embeddings";
import { vectorService } from "../src/lib/vector";
import { createServiceClient } from "../src/lib/supabase/server";

const KNOWLEDGE_BASE_DIR = "./knowledge_base";
const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000"; // System user

interface KnowledgeDoc {
  filePath: string;
  category: string;
  title: string;
  metadata: Record<string, string>;
}

async function seedKnowledgeBase() {
  console.log("🚀 Starting knowledge base seeding...\n");
  
  const supabase = createServiceClient();
  const docs = discoverDocuments(KNOWLEDGE_BASE_DIR);
  
  console.log(`Found ${docs.length} documents to process\n`);
  
  for (const doc of docs) {
    try {
      console.log(`📄 Processing: ${doc.title}`);
      
      // Read file
      const buffer = fs.readFileSync(doc.filePath);
      const fileType = path.extname(doc.filePath).slice(1);
      
      // Extract text
      const processed = await documentProcessor.extractText(
        buffer, fileType, doc.title
      );
      
      // Chunk document
      const chunks = documentProcessor.chunkDocument(
        documentProcessor.normalizeText(processed.text)
      );
      
      console.log(`   → ${chunks.length} chunks created`);
      
      // Generate embeddings
      const embeddings = await embeddingService.embedBatch(
        chunks.map(c => c.content)
      );
      
      // Store in database
      const docId = crypto.randomUUID();
      
      await supabase.from("documents").insert({
        id: docId,
        user_id: SYSTEM_USER_ID,
        title: doc.title,
        original_filename: path.basename(doc.filePath),
        file_type: fileType,
        file_size: buffer.length,
        storage_path: `system/${doc.category}/${path.basename(doc.filePath)}`,
        document_type: doc.category,
        status: "completed",
        raw_text: processed.text,
        is_system: true, // Add this column to schema
      });
      
      // Store chunks
      const chunkRecords = chunks.map((chunk, i) => ({
        id: chunk.id,
        document_id: docId,
        chunk_index: i,
        content: chunk.content,
        metadata: { ...chunk.metadata, ...doc.metadata },
        vector_id: chunk.id,
      }));
      
      await supabase.from("document_chunks").insert(chunkRecords);
      
      // Store vectors
      const vectorDocs = chunks.map((chunk, i) => ({
        id: chunk.id,
        content: chunk.content,
        embedding: embeddings[i],
        metadata: {
          documentId: docId,
          userId: SYSTEM_USER_ID,
          category: doc.category,
          isSystem: true,
          ...doc.metadata,
        },
      }));
      
      await vectorService.upsertVectors(vectorDocs);
      
      console.log(`   ✅ Done\n`);
      
      // Rate limiting
      await new Promise(r => setTimeout(r, 1000));
      
    } catch (error) {
      console.error(`   ❌ Error: ${error}\n`);
    }
  }
  
  console.log("🎉 Knowledge base seeding complete!");
}

function discoverDocuments(dir: string): KnowledgeDoc[] {
  const docs: KnowledgeDoc[] = [];
  
  const categories = fs.readdirSync(dir);
  
  for (const category of categories) {
    const categoryPath = path.join(dir, category);
    if (!fs.statSync(categoryPath).isDirectory()) continue;
    
    const files = fs.readdirSync(categoryPath);
    
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (![".pdf", ".docx", ".txt"].includes(ext)) continue;
      
      docs.push({
        filePath: path.join(categoryPath, file),
        category: category,
        title: file.replace(ext, "").replace(/_/g, " "),
        metadata: {
          category,
          source: "system",
        },
      });
    }
  }
  
  return docs;
}

// Run
seedKnowledgeBase().catch(console.error);
```

### Step 2: Add System User Schema

Add to your migration:

```sql
-- System user for knowledge base documents
INSERT INTO public.users (id, email, full_name, role)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'system@patrasaar.local',
  'System Knowledge Base',
  'admin'
) ON CONFLICT DO NOTHING;

-- Add is_system column to documents
ALTER TABLE public.documents 
ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT FALSE;

-- Index for fast system document queries
CREATE INDEX IF NOT EXISTS idx_documents_system 
ON public.documents(is_system) WHERE is_system = TRUE;
```

### Step 3: Prepare Your Documents

1. Create the folder structure:
```bash
mkdir -p knowledge_base/acts
mkdir -p knowledge_base/rules
mkdir -p knowledge_base/templates
mkdir -p knowledge_base/judgments
```

2. Download key documents:

**Indian Penal Code:**
- https://indiacode.nic.in/handle/123456789/2263

**Criminal Procedure Code:**
- https://indiacode.nic.in/handle/123456789/1611

**Contract Act:**
- https://indiacode.nic.in/handle/123456789/2187

### Step 4: Run the Seed Script

```bash
npx tsx scripts/seed-knowledge-base.ts
```

---

## Updating the Query to Include System Knowledge

Modify `src/lib/rag/pipeline.ts` to search both user and system documents:

```typescript
// In the query method, update the search filter:
const searchResults = await vectorService.search(queryEmbedding, {
  limit: topK,
  filter: documentId 
    ? { documentId }  // Specific document
    : {
        // Search user's docs AND system knowledge base
        $or: [
          { userId },
          { isSystem: true }
        ]
      },
});
```

---

## Recommended Datasets

### Immediate (Start with these)

1. **IPC Sections** - ~500 sections, essential for criminal law queries
2. **Contract Act** - ~238 sections, for business/contract queries  
3. **Consumer Protection Act** - For consumer rights queries
4. **RTI Act** - Common citizen queries

### Phase 2

1. **State-specific Acts** - Maharashtra Rent Control, etc.
2. **Landmark Supreme Court judgments** - Top 100
3. **Legal templates** - FIR, notices, agreements

### Phase 3

1. **Full case law database** - Indian Kanoon scrape
2. **Government circulars** - Tax, compliance
3. **Legal glossary** - Term definitions

---

## Maintenance

### Adding New Documents

```bash
# Add files to knowledge_base/
cp new_act.pdf knowledge_base/acts/

# Re-run seeder (it will skip existing)
npx tsx scripts/seed-knowledge-base.ts
```

### Updating Existing Documents

```typescript
// Delete old vectors first
await vectorService.deleteByDocumentId(oldDocId);

// Re-ingest
await seedDocument(newFilePath);
```

---

## Best Practices

1. **Chunk size**: 500 tokens works well for legal text
2. **Overlap**: 50-100 tokens to preserve context
3. **Metadata**: Always include section numbers, act names
4. **Rate limiting**: 1 sec delay between docs to respect API limits
5. **Deduplication**: Check for existing docs before re-ingesting

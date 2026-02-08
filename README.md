# PatraSaar - Legal Document Simplification Platform

> **Legal clarity, distilled.**  
> An AI-powered platform for simplifying Indian legal documents using RAG (Retrieval-Augmented Generation).

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Free accounts on:
  - [Supabase](https://supabase.com) - Database, Auth, Storage
  - [Qdrant Cloud](https://cloud.qdrant.io) - Vector Database
  - [Groq](https://console.groq.com) or [Google AI Studio](https://makersuite.google.com) - LLM API

### Setup

1. **Clone and install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your API keys
   ```

3. **Set up Supabase database**
   - Create a new project at [supabase.com](https://supabase.com)
   - Go to SQL Editor and run the migration script:
     ```
     supabase/migrations/001_initial_schema.sql
     ```
   - Create a storage bucket named `documents` (private, 5MB limit)

4. **Set up Qdrant vector database**
   - Create a free cluster at [cloud.qdrant.io](https://cloud.qdrant.io)
   - Copy the URL and API key to `.env.local`

5. **Run the development server**
   ```bash
   npm run dev
   ```

## 🏗️ Architecture

```
src/
├── app/
│   ├── api/
│   │   ├── documents/     # Document upload & management
│   │   ├── query/         # RAG-powered Q&A
│   │   └── usage/         # Usage statistics
│   └── ...
├── lib/
│   ├── supabase/          # Database client & types
│   ├── llm/               # Groq/Gemini integration
│   ├── vector/            # Qdrant vector operations
│   ├── embeddings/        # HuggingFace embeddings
│   ├── documents/         # PDF/DOCX processing
│   └── rag/               # RAG pipeline orchestration
```

## 📡 API Endpoints

### Documents
- `POST /api/documents` - Upload a legal document
- `GET /api/documents` - List user's documents
- `GET /api/documents/[id]` - Get document details
- `DELETE /api/documents/[id]` - Delete a document

### Query
- `POST /api/query` - Ask a question (RAG-powered)
- `GET /api/query` - Get query history

### Usage
- `GET /api/usage` - Get current usage statistics

## 🔧 Tech Stack

| Component | Technology | Free Tier |
|-----------|-----------|-----------|
| Frontend | Next.js 14, TypeScript, Tailwind | ✅ |
| Database | Supabase PostgreSQL | 500MB |
| Auth | Supabase Auth | 50K MAU |
| Storage | Supabase Storage | 1GB |
| Vector DB | Qdrant Cloud | 1GB |
| LLM | Groq / Google Gemini | Free tier |
| OCR | Tesseract.js | Open source |
| Embeddings | HuggingFace | Free API |

## 📊 Free Tier Limits

| Feature | Limit |
|---------|-------|
| Document Uploads | 10/month |
| Queries | 50/month |
| Max File Size | 5MB |
| Total Storage | 50MB |

## 🔐 Security

- Row Level Security (RLS) on all tables
- Documents encrypted in Supabase Storage
- No cross-user data access
- Full audit logging

## ⚠️ Disclaimer

PatraSaar is for **informational purposes only** and does not constitute legal advice. Always consult a qualified lawyer for specific legal matters.

## 📄 License

MIT

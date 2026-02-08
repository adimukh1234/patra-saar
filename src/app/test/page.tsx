"use client";

import { useState } from "react";

export default function TestPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [documentId, setDocumentId] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [answer, setAnswer] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  const handleUpload = async () => {
    if (!file) {
      setUploadStatus("Please select a file first");
      return;
    }

    setIsLoading(true);
    setUploadStatus("Uploading and processing...");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", file.name);

      const response = await fetch("/api/test/documents", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        setDocumentId(data.documentId);
        setUploadStatus(`✅ Uploaded! Document ID: ${data.documentId}`);
      } else {
        setUploadStatus(`❌ Error: ${data.error || "Upload failed"}`);
      }
    } catch (error) {
      setUploadStatus(`❌ Error: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuery = async () => {
    if (!query.trim()) {
      setAnswer("Please enter a question");
      return;
    }

    setIsLoading(true);
    setAnswer("Thinking...");

    try {
      const response = await fetch("/api/test/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query,
          documentId: documentId || undefined,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        let result = data.answer || "No answer generated";
        
        if (data.citations && data.citations.length > 0) {
          result += "\n\n📚 Citations:\n";
          data.citations.forEach((c: { section?: string; content: string }, i: number) => {
            result += `\n${i + 1}. ${c.section || "Source"}: "${c.content.slice(0, 100)}..."`;
          });
        }
        
        if (data.disclaimer) {
          result += `\n\n⚠️ ${data.disclaimer}`;
        }
        
        setAnswer(result);
      } else {
        setAnswer(`❌ Error: ${data.error || "Query failed"}`);
      }
    } catch (error) {
      setAnswer(`❌ Error: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ 
      maxWidth: "800px", 
      margin: "40px auto", 
      padding: "20px",
      fontFamily: "system-ui, sans-serif"
    }}>
      <h1 style={{ color: "#1a1a2e", marginBottom: "10px" }}>
        🧪 PatraSaar RAG Test
      </h1>
      <p style={{ color: "#666", marginBottom: "30px" }}>
        Upload a legal document and ask questions about it.
      </p>

      {/* Upload Section */}
      <div style={{ 
        background: "#f8f9fa", 
        padding: "20px", 
        borderRadius: "8px",
        marginBottom: "20px"
      }}>
        <h2 style={{ margin: "0 0 15px 0", fontSize: "18px" }}>
          📄 Step 1: Upload Document
        </h2>
        
        <input
          type="file"
          accept=".pdf,.docx,.txt"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          style={{ marginBottom: "10px", display: "block" }}
        />
        
        <button
          onClick={handleUpload}
          disabled={isLoading || !file}
          style={{
            background: "#4361ee",
            color: "white",
            border: "none",
            padding: "10px 20px",
            borderRadius: "5px",
            cursor: isLoading ? "not-allowed" : "pointer",
            opacity: isLoading || !file ? 0.6 : 1,
          }}
        >
          {isLoading ? "Processing..." : "Upload & Process"}
        </button>
        
        {uploadStatus && (
          <p style={{ 
            marginTop: "10px", 
            padding: "10px",
            background: uploadStatus.includes("✅") ? "#d4edda" : 
                       uploadStatus.includes("❌") ? "#f8d7da" : "#fff3cd",
            borderRadius: "4px"
          }}>
            {uploadStatus}
          </p>
        )}
      </div>

      {/* Query Section */}
      <div style={{ 
        background: "#f8f9fa", 
        padding: "20px", 
        borderRadius: "8px" 
      }}>
        <h2 style={{ margin: "0 0 15px 0", fontSize: "18px" }}>
          💬 Step 2: Ask a Question
        </h2>
        
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g., What are the payment terms? What is the notice period?"
          style={{
            width: "100%",
            minHeight: "80px",
            padding: "10px",
            borderRadius: "5px",
            border: "1px solid #ddd",
            marginBottom: "10px",
            fontFamily: "inherit",
            fontSize: "14px",
            boxSizing: "border-box",
          }}
        />
        
        <button
          onClick={handleQuery}
          disabled={isLoading || !query.trim()}
          style={{
            background: "#2ecc71",
            color: "white",
            border: "none",
            padding: "10px 20px",
            borderRadius: "5px",
            cursor: isLoading ? "not-allowed" : "pointer",
            opacity: isLoading || !query.trim() ? 0.6 : 1,
          }}
        >
          {isLoading ? "Processing..." : "Ask Question"}
        </button>
        
        {answer && (
          <div style={{ 
            marginTop: "15px", 
            padding: "15px",
            background: "white",
            borderRadius: "4px",
            border: "1px solid #ddd",
            whiteSpace: "pre-wrap",
            lineHeight: "1.6"
          }}>
            <strong>Answer:</strong>
            <p style={{ margin: "10px 0 0 0" }}>{answer}</p>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div style={{ 
        marginTop: "30px", 
        padding: "15px", 
        background: "#e7f3ff",
        borderRadius: "8px",
        fontSize: "14px"
      }}>
        <strong>📝 Test Instructions:</strong>
        <ol style={{ margin: "10px 0 0 0", paddingLeft: "20px" }}>
          <li>Upload a PDF, DOCX, or TXT file (max 5MB)</li>
          <li>Wait for processing to complete</li>
          <li>Type a question about the document</li>
          <li>Get an AI-powered answer with citations</li>
        </ol>
      </div>
    </div>
  );
}

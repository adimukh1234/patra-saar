// scripts/test-backend.ts
// Tests all backend services to verify they're working correctly
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const TESTS = {
  supabase: false,
  qdrant: false,
  llm: false,
  embeddings: false,
};

async function main() {
  console.log("🧪 PatraSaar Backend Test Suite\n");
  console.log("=" .repeat(50) + "\n");

  // Test 1: Supabase Connection
  await testSupabase();

  // Test 2: Qdrant Connection  
  await testQdrant();

  // Test 3: LLM API
  await testLLM();

  // Test 4: Embeddings
  await testEmbeddings();

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("\n📊 Test Summary:\n");
  
  let passed = 0;
  let failed = 0;
  
  for (const [name, result] of Object.entries(TESTS)) {
    const icon = result ? "✅" : "❌";
    console.log(`   ${icon} ${name.charAt(0).toUpperCase() + name.slice(1)}`);
    if (result) passed++;
    else failed++;
  }
  
  console.log(`\n   Total: ${passed}/${passed + failed} passed\n`);
  
  if (failed === 0) {
    console.log("🎉 All tests passed! Backend is ready.\n");
  } else {
    console.log("⚠️ Some tests failed. Check your .env.local configuration.\n");
  }
}

async function testSupabase() {
  console.log("1️⃣ Testing Supabase Connection...");
  
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!url || !key) {
    console.log("   ❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY\n");
    return;
  }
  
  try {
    const supabase = createClient(url, key);
    
    // Try to query users table (should exist after migration)
    const { error } = await supabase.from("users").select("id").limit(1);
    
    if (error) {
      console.log(`   ❌ Database query failed: ${error.message}`);
      console.log("   💡 Make sure you ran the migration in supabase/migrations/001_initial_schema.sql\n");
      return;
    }
    
    console.log("   ✅ Supabase connected successfully!\n");
    TESTS.supabase = true;
  } catch (err) {
    console.log(`   ❌ Connection error: ${err}\n`);
  }
}

async function testQdrant() {
  console.log("2️⃣ Testing Qdrant Vector DB...");
  
  const url = process.env.QDRANT_URL;
  const apiKey = process.env.QDRANT_API_KEY;
  
  if (!url) {
    console.log("   ❌ Missing QDRANT_URL\n");
    return;
  }
  
  try {
    // Test cluster health
    const response = await fetch(`${url}/collections`, {
      headers: apiKey ? { "api-key": apiKey } : {},
    });
    
    if (!response.ok) {
      console.log(`   ❌ Qdrant API error: ${response.status} ${response.statusText}`);
      console.log("   💡 Check your QDRANT_URL and QDRANT_API_KEY\n");
      return;
    }
    
    const data = await response.json();
    console.log(`   ✅ Qdrant connected! Collections: ${data.result?.collections?.length || 0}\n`);
    TESTS.qdrant = true;
  } catch (err) {
    console.log(`   ❌ Connection error: ${err}\n`);
  }
}

async function testLLM() {
  console.log("3️⃣ Testing LLM API (Groq/Gemini)...");
  
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  
  if (!groqKey && !geminiKey) {
    console.log("   ❌ Missing both GROQ_API_KEY and GEMINI_API_KEY");
    console.log("   💡 You need at least one LLM API key\n");
    return;
  }
  
  // Try Groq first
  if (groqKey) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${groqKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: "Say 'test' and nothing else." }],
          max_tokens: 10,
        }),
      });
      
      if (response.ok) {
        console.log("   ✅ Groq LLM connected!\n");
        TESTS.llm = true;
        return;
      } else {
        const errorData = await response.json();
        console.log(`   ⚠️ Groq error: ${errorData.error?.message || response.status}`);
      }
    } catch (err) {
      console.log(`   ⚠️ Groq connection failed: ${err}`);
    }
  }
  
  // Try Gemini as fallback
  if (geminiKey) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: "Say 'test' and nothing else." }] }],
          }),
        }
      );
      
      if (response.ok) {
        console.log("   ✅ Gemini LLM connected!\n");
        TESTS.llm = true;
        return;
      } else {
        const errorData = await response.json();
        console.log(`   ⚠️ Gemini error: ${errorData.error?.message || response.status}`);
      }
    } catch (err) {
      console.log(`   ⚠️ Gemini connection failed: ${err}`);
    }
  }
  
  console.log("   ❌ No LLM provider working\n");
}

async function testEmbeddings() {
  console.log("4️⃣ Testing Embeddings (Local Hash)...");
  
  try {
    // Import and test the local embedding service
    const { embeddingService } = await import("../src/lib/embeddings");
    
    const testText = "This is a test sentence for embedding.";
    const embedding = await embeddingService.embed(testText);
    
    if (!embedding || embedding.length === 0) {
      console.log("   ❌ Embedding returned empty array\n");
      return;
    }
    
    const dimension = embedding.length;
    const hasValues = embedding.some((v) => v !== 0);
    
    if (!hasValues) {
      console.log("   ❌ Embedding has all zero values\n");
      return;
    }
    
    console.log(`   ✅ Embeddings working! Dimension: ${dimension}\n`);
    TESTS.embeddings = true;
  } catch (err) {
    console.log(`   ❌ Embedding error: ${err}\n`);
  }
}

// Run tests
main().catch(console.error);

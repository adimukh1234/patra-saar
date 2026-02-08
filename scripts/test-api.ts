// scripts/test-api.ts
// Tests the API endpoints to verify they work correctly
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const BASE_URL = "http://localhost:3000";

// Initialize Supabase for creating test user
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

let testUserId: string | null = null;
let testSession: { access_token: string } | null = null;

async function main() {
  console.log("🧪 PatraSaar API Test Suite\n");
  console.log("=".repeat(50) + "\n");

  // Check if dev server is running
  const serverUp = await checkServer();
  if (!serverUp) {
    console.log("❌ Dev server not running. Please run: npm run dev\n");
    return;
  }

  console.log("✅ Dev server is running\n");

  // Create test user
  await setupTestUser();

  if (!testSession) {
    console.log("❌ Could not create test session. Skipping API tests.\n");
    return;
  }

  // Run API tests
  await testUsageAPI();
  await testDocumentsAPI();
  await testQueryAPI();

  // Cleanup
  await cleanup();

  console.log("\n" + "=".repeat(50));
  console.log("\n🎉 API tests complete!\n");
}

async function checkServer(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}`, { method: "HEAD" });
    return response.ok || response.status === 404; // Next.js returns 404 for HEAD
  } catch {
    return false;
  }
}

async function setupTestUser() {
  console.log("📋 Setting up test user...\n");

  const testEmail = `test-${Date.now()}@patrasaar.test`;
  const testPassword = "TestPassword123!";

  try {
    // Create user via Supabase Admin API
    const { data: user, error } = await supabase.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    });

    if (error) {
      console.log(`   ⚠️ Could not create user: ${error.message}`);
      
      // Try to sign in with existing test user
      const { data: signInData, error: signInError } = 
        await supabase.auth.signInWithPassword({
          email: "test@patrasaar.test",
          password: testPassword,
        });

      if (signInError) {
        console.log(`   ❌ Could not sign in: ${signInError.message}\n`);
        return;
      }

      testUserId = signInData.user?.id || null;
      testSession = signInData.session;
    } else {
      testUserId = user.user?.id || null;
      
      // Sign in to get session
      const { data: signInData } = await supabase.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });
      testSession = signInData.session;
    }

    console.log(`   ✅ Test user ready (ID: ${testUserId?.slice(0, 8)}...)\n`);
  } catch (err) {
    console.log(`   ❌ Setup error: ${err}\n`);
  }
}

async function testUsageAPI() {
  console.log("1️⃣ Testing GET /api/usage...");

  try {
    const response = await fetch(`${BASE_URL}/api/usage`, {
      headers: {
        Authorization: `Bearer ${testSession!.access_token}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`   ✅ Response: ${JSON.stringify(data).slice(0, 100)}...`);
    } else {
      const error = await response.text();
      console.log(`   ⚠️ Status ${response.status}: ${error.slice(0, 100)}`);
    }
  } catch (err) {
    console.log(`   ❌ Error: ${err}`);
  }
  console.log();
}

async function testDocumentsAPI() {
  console.log("2️⃣ Testing Documents API...\n");

  // Test GET /api/documents (list)
  console.log("   a) GET /api/documents (list)...");
  try {
    const response = await fetch(`${BASE_URL}/api/documents`, {
      headers: {
        Authorization: `Bearer ${testSession!.access_token}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`      ✅ Got ${data.documents?.length || 0} documents`);
    } else {
      console.log(`      ⚠️ Status ${response.status}`);
    }
  } catch (err) {
    console.log(`      ❌ Error: ${err}`);
  }

  // Test POST /api/documents (upload)
  console.log("   b) POST /api/documents (upload)...");
  
  // Create a test file
  const testContent = `
    SAMPLE LEGAL DOCUMENT
    
    Section 1: Definitions
    "Agreement" means this Service Agreement between the parties.
    "Effective Date" means the date of signing this agreement.
    
    Section 2: Terms
    The service shall be provided for a period of 12 months.
    Either party may terminate with 30 days written notice.
    
    Section 3: Payment
    Payment is due within 30 days of invoice date.
    Late payments incur 1.5% monthly interest.
  `;
  
  const testFilePath = path.join(process.cwd(), "test-document.txt");
  fs.writeFileSync(testFilePath, testContent);

  try {
    const formData = new FormData();
    const fileBlob = new Blob([testContent], { type: "text/plain" });
    formData.append("file", fileBlob, "test-document.txt");
    formData.append("title", "Test Legal Document");

    const response = await fetch(`${BASE_URL}/api/documents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testSession!.access_token}`,
      },
      body: formData,
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`      ✅ Uploaded! ID: ${data.documentId?.slice(0, 8)}...`);
    } else {
      const error = await response.text();
      console.log(`      ⚠️ Status ${response.status}: ${error.slice(0, 100)}`);
    }
  } catch (err) {
    console.log(`      ❌ Error: ${err}`);
  } finally {
    // Clean up test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  }
  console.log();
}

async function testQueryAPI() {
  console.log("3️⃣ Testing Query API...\n");

  // Test POST /api/query
  console.log("   a) POST /api/query...");
  try {
    const response = await fetch(`${BASE_URL}/api/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testSession!.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "What are the payment terms?",
      }),
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`      ✅ Got response: "${data.answer?.slice(0, 80)}..."`);
    } else {
      const error = await response.text();
      console.log(`      ⚠️ Status ${response.status}: ${error.slice(0, 100)}`);
    }
  } catch (err) {
    console.log(`      ❌ Error: ${err}`);
  }

  // Test GET /api/query (history)
  console.log("   b) GET /api/query (history)...");
  try {
    const response = await fetch(`${BASE_URL}/api/query`, {
      headers: {
        Authorization: `Bearer ${testSession!.access_token}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`      ✅ Got ${data.queries?.length || 0} queries in history`);
    } else {
      console.log(`      ⚠️ Status ${response.status}`);
    }
  } catch (err) {
    console.log(`      ❌ Error: ${err}`);
  }
  console.log();
}

async function cleanup() {
  console.log("🧹 Cleaning up test user...");
  
  if (testUserId) {
    try {
      await supabase.auth.admin.deleteUser(testUserId);
      console.log("   ✅ Test user deleted\n");
    } catch (err) {
      console.log(`   ⚠️ Could not delete test user: ${err}\n`);
    }
  }
}

// Run
main().catch(console.error);

// LLM Service - Unified interface for Groq and Gemini
import Groq from "groq-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

export type LLMProvider = "groq" | "gemini";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  tokensUsed: number;
  provider: LLMProvider;
}

// Legal system prompt for PatraSaar
const LEGAL_SYSTEM_PROMPT = `You are PatraSaar, an AI assistant specialized in simplifying Indian legal documents.
Your role is to help users understand legal text without providing legal advice.

Guidelines:
1. Always explain legal terms in simple, everyday language
2. Every claim MUST be backed by specific citations (Act, Section, Judgment) when available
3. If uncertain, clearly state "I'm not certain about this"
4. Always end with: "⚠️ This is for informational purposes only, not legal advice."
5. Highlight potential risks and obligations clearly
6. When explaining judgments, include the case citation
7. Use bullet points and clear formatting for readability

Response Format:
- Summary: Brief overview in 2-3 sentences
- Detailed Explanation: Clear breakdown of key points
- Relevant Citations: List of applicable laws/sections (if found in context)
- Key Obligations: What the user must do (if applicable)
- Potential Risks: Areas of concern (if applicable)`;

class LLMService {
  private groqClient: Groq | null = null;
  private geminiClient: GoogleGenerativeAI | null = null;

  constructor() {
    // Initialize Groq if API key available
    if (process.env.GROQ_API_KEY) {
      this.groqClient = new Groq({
        apiKey: process.env.GROQ_API_KEY,
      });
    }

    // Initialize Gemini if API key available
    if (process.env.GOOGLE_GEMINI_API_KEY) {
      this.geminiClient = new GoogleGenerativeAI(
        process.env.GOOGLE_GEMINI_API_KEY
      );
    }
  }

  async chat(
    messages: LLMMessage[],
    options: {
      provider?: LLMProvider;
      maxTokens?: number;
      temperature?: number;
    } = {}
  ): Promise<LLMResponse> {
    const { provider = this.getDefaultProvider(), maxTokens = 2048, temperature = 0.3 } = options;

    if (provider === "groq") {
      return this.chatWithGroq(messages, maxTokens, temperature);
    } else {
      return this.chatWithGemini(messages, maxTokens, temperature);
    }
  }

  private getDefaultProvider(): LLMProvider {
    // Prefer Groq for speed, fallback to Gemini
    if (this.groqClient) return "groq";
    if (this.geminiClient) return "gemini";
    throw new Error("No LLM provider configured. Set GROQ_API_KEY or GOOGLE_GEMINI_API_KEY");
  }

  private async chatWithGroq(
    messages: LLMMessage[],
    maxTokens: number,
    temperature: number
  ): Promise<LLMResponse> {
    if (!this.groqClient) {
      throw new Error("Groq client not initialized");
    }

    const response = await this.groqClient.chat.completions.create({
      model: "llama-3.3-70b-versatile", // Free, fast, high quality
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: maxTokens,
      temperature,
    });

    return {
      content: response.choices[0]?.message?.content || "",
      tokensUsed: response.usage?.total_tokens || 0,
      provider: "groq",
    };
  }

  private async chatWithGemini(
    messages: LLMMessage[],
    maxTokens: number,
    temperature: number
  ): Promise<LLMResponse> {
    if (!this.geminiClient) {
      throw new Error("Gemini client not initialized");
    }

    const model = this.geminiClient.getGenerativeModel({
      model: "gemini-1.5-flash", // Free, fast
    });

    // Convert messages to Gemini format
    const systemMessage = messages.find((m) => m.role === "system");
    const chatMessages = messages.filter((m) => m.role !== "system");

    const prompt =
      (systemMessage ? `${systemMessage.content}\n\n` : "") +
      chatMessages.map((m) => `${m.role}: ${m.content}`).join("\n\n");

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
      },
    });

    const response = result.response;
    return {
      content: response.text(),
      tokensUsed: 0, // Gemini doesn't always return token count
      provider: "gemini",
    };
  }

  // Convenience method for legal document analysis
  async analyzeLegalDocument(
    documentText: string,
    userQuery?: string
  ): Promise<LLMResponse> {
    const messages: LLMMessage[] = [
      { role: "system", content: LEGAL_SYSTEM_PROMPT },
      {
        role: "user",
        content: userQuery
          ? `Document:\n${documentText}\n\nQuestion: ${userQuery}`
          : `Please analyze and simplify the following legal document:\n\n${documentText}`,
      },
    ];

    return this.chat(messages);
  }

  // Method for answering questions with retrieved context
  async answerWithContext(
    context: string,
    query: string,
    documentTitle?: string
  ): Promise<LLMResponse> {
    const messages: LLMMessage[] = [
      { role: "system", content: LEGAL_SYSTEM_PROMPT },
      {
        role: "user",
        content: `${documentTitle ? `Document: ${documentTitle}\n\n` : ""}Retrieved Legal Context:\n${context}\n\nUser Question: ${query}`,
      },
    ];

    return this.chat(messages);
  }
}

// Export singleton instance
export const llmService = new LLMService();

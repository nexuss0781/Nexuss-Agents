import { describe, expect, it } from "vitest";
import { classifyConversationHandoff } from "./conversationHandoff";

describe("Phase 13 conversation-to-mission handoff", () => {
  it("keeps greetings and ordinary questions in conversation", () => {
    expect(classifyConversationHandoff({ prompt: "Hello, how are you?", mode: "complex" })).toMatchObject({ route: "conversation", intent: "question" });
    expect(classifyConversationHandoff({ prompt: "Explain what a vector database is", mode: "general" })).toMatchObject({ route: "conversation", intent: "explanation" });
    expect(classifyConversationHandoff({ prompt: "Can you help me think through this?", mode: "instant" })).toMatchObject({ route: "conversation" });
  });

  it("hands actionable complex-mode requests to mission intake", () => {
    expect(classifyConversationHandoff({ prompt: "Implement the authentication fix and run the tests", mode: "complex" })).toMatchObject({ route: "mission", intent: "coding_request", confidence: "high" });
    expect(classifyConversationHandoff({ prompt: "Research the tradeoffs between these approaches", mode: "complex" })).toMatchObject({ route: "mission", intent: "research_request" });
    expect(classifyConversationHandoff({ prompt: "Prove that the algorithm terminates", mode: "complex" })).toMatchObject({ route: "mission", intent: "mathematics_request" });
  });

  it("routes attachments to Complex intake but keeps General outside mission mode", () => {
    expect(classifyConversationHandoff({ prompt: "Here is the context", mode: "complex", hasAttachments: true })).toMatchObject({ route: "mission", intent: "work_request" });
    expect(classifyConversationHandoff({ prompt: "Here is the context", mode: "general", hasAttachments: true })).toMatchObject({ route: "conversation" });
  });
});

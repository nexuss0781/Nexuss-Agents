export type ConversationMode = "complex" | "general" | "instant";
export type ConversationRoute = "conversation" | "mission";
export type ConversationIntent = "chat" | "question" | "explanation" | "work_request" | "research_request" | "coding_request" | "mathematics_request" | "clarification";

export type ConversationHandoffInput = {
  prompt: string;
  mode: ConversationMode;
  hasAttachments?: boolean;
};

export type ConversationHandoffDecision = {
  route: ConversationRoute;
  intent: ConversationIntent;
  confidence: "low" | "medium" | "high";
  reason: string;
};

const ACTION_PATTERN = /\b(?:build|create|implement|add|remove|delete|fix|debug|refactor|modify|change|update|write|design|develop|deploy|publish|research|investigate|analyze|compare|plan|automate|set up|setup|migrate|test|run|ship|prove|derive|calculate)\b/i;
const DIRECT_REQUEST_PATTERN = /\b(?:i need you to|please make|please do|can you build|can you create|can you fix|help me build|help me create|help me fix)\b/i;
const CODING_PATTERN = /\b(?:code|coding|repository|repo|github|file|function|component|api|bug|typescript|javascript|python|program|compile|test suite|authentication|auth|software|application|app)\b/i;
const RESEARCH_PATTERN = /\b(?:research|investigate|literature|sources|paper|evidence|compare|analysis|analyze)\b/i;
const MATHEMATICS_PATTERN = /\b(?:prove|proof|derive|equation|theorem|mathematics|math|integral|matrix|calculate)\b/i;
const EXPLANATION_PATTERN = /\b(?:explain|how does|how do|what is|why does|why do)\b/i;

export function classifyConversationHandoff(input: ConversationHandoffInput): ConversationHandoffDecision {
  const prompt = input.prompt.trim();
  if (!prompt) return { route: "conversation", intent: "chat", confidence: "high", reason: "Empty turns remain in the conversation surface" };
  if (input.hasAttachments && input.mode === "complex") return { route: "mission", intent: "work_request", confidence: "high", reason: "Attachments require intake so their source references and acceptance context are preserved" };
  const actionable = ACTION_PATTERN.test(prompt) || DIRECT_REQUEST_PATTERN.test(prompt);
  if (input.mode !== "complex" || !actionable) {
    const intent: ConversationIntent = MATHEMATICS_PATTERN.test(prompt) ? "mathematics_request" : RESEARCH_PATTERN.test(prompt) ? "research_request" : EXPLANATION_PATTERN.test(prompt) ? "explanation" : /\?$/.test(prompt) ? "question" : "chat";
    return { route: "conversation", intent, confidence: actionable ? "medium" : "high", reason: input.mode === "complex" && !actionable ? "The request is conversational and does not contain an actionable work signal" : "General and instant modes remain conversational unless explicitly handed to complex work" };
  }
  const intent: ConversationIntent = MATHEMATICS_PATTERN.test(prompt) ? "mathematics_request" : RESEARCH_PATTERN.test(prompt) ? "research_request" : CODING_PATTERN.test(prompt) ? "coding_request" : "work_request";
  return { route: "mission", intent, confidence: "high", reason: "Complex mode contains an actionable request and will enter mission intake" };
}

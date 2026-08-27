import { readFileSync } from "node:fs";
import path from "node:path";

export type GeneralMode = "plan" | "build";

const GENERAL_PROMPT_PATH = process.env.NEXUSS_GENERAL_PROMPT_PATH || path.join(process.cwd(), "General", "Prompt.md");

function loadGeneralPrompt() {
  const content = readFileSync(GENERAL_PROMPT_PATH, "utf8").trim();
  if (!content) throw new Error(`General prompt is empty: ${GENERAL_PROMPT_PATH}`);
  return content;
}

export const GENERAL_AGENT_SYSTEM_PROMPT = loadGeneralPrompt();
export const GENERAL_AGENT_SYSTEM_PROMPT_VERSION = "1.0.0" as const;

export function composeGeneralSystemPrompt(mode: GeneralMode = "plan") {
  const modeInstructions = mode === "build"
    ? "Active mode: Build. Inspect enough to understand the request, then implement through the available capabilities, verify the result, repair failures, report, and remain ready for the next build request."
    : "Active mode: Plan Enabled. Inspect, read, search, and analyze without modifying project files. Present the implementation plan and wait for explicit approval before any modifying operation.";
  return `${GENERAL_AGENT_SYSTEM_PROMPT}\n\n## Current mode\n\n${modeInstructions}`;
}

export default GENERAL_AGENT_SYSTEM_PROMPT;

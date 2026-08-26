# Conversation-to-Mission Handoff Contract

## Purpose

Nexuss-Agent has one conversational surface with two internal paths. Ordinary conversation stays with the assistant response stream. Actionable complex work enters mission intake and continues through planning, execution, verification, repair, and reporting.

The handoff is internal. The user receives a natural response or a natural clarification question; internal routing labels, queues, stage names, worker leases, and policy diagnostics are not placed into ordinary chat messages.

## Routing rule

| Input | Route |
|---|---|
| Greeting, discussion, ordinary question, explanation, or quick thought | `conversation` |
| Actionable request in `complex` mode | `mission` |
| Attached files or specifications | `mission` so source references and intake context are retained |
| Actionable language in `general` or `instant` mode | `conversation` unless the user changes to complex work mode |
| Vague actionable request such as “fix it” | `mission`, followed by intake clarification if the desired outcome is materially ambiguous |

## Intent vocabulary

The classifier recognizes `chat`, `question`, `explanation`, `work_request`, `research_request`, `coding_request`, `mathematics_request`, and `clarification`. Intent helps select intake and domain skills; it does not grant authority or bypass the mission runner.

## Handoff sequence

```text
user turn
  → conversation intent classification
  → conversation stream OR mission intake
  → clarification when required
  → mission creation only for a ready intake decision
  → mission start
  → natural acknowledgement in the thread
  → status projection through the workspace
  → final result returned as a normal assistant message
```

## Clarification behavior

When intake returns `needs_clarification`, no mission is created and no runner starts. The thread receives a concise natural question that identifies the missing outcome or constraint. The request remains available in the composer for refinement.

## Error behavior

If the handoff classifier is temporarily unavailable, the client uses its existing deterministic fallback. If mission intake fails, the original prompt is restored to the composer and only an operator-facing error toast is shown. Internal classifier output is never displayed as a chat message.

## Extension behavior

Future intent classifiers may become model-assisted, but they must return the same typed decision, preserve deterministic fallback behavior, and never move an ordinary conversation into execution without the selected work mode and actionable signal.

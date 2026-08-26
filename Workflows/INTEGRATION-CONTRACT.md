# End-to-End Mission Integration Contract

## Scope

Phase 14 connects the mission lifecycle that was implemented across Phases 1–13. It provides one launch boundary from a user request to intake, planning, domain-skill binding, capability enforcement, execution, evidence, verification, adaptive repair, recovery, and final reporting.

## Unified launch boundary

`launchMissionFromConversation()` is the server-side lifecycle boundary. It performs the following sequence:

```text
intake sources
  → normalize and classify intake
  → return clarification without mission creation when blocked by ambiguity
  → create a typed mission when ready
  → queue the mission exactly once
  → return mission state and a natural assistant acknowledgement
```

The chat client uses this boundary for complex actionable requests. It no longer performs mission creation and mission queueing as two separate user-facing operations.

## Complete lifecycle

```text
conversation handoff
  → mission intake
  → mission creation
  → queue
  → planning
  → domain skill selection
  → work-item capability binding
  → execution
  → durable artifacts and evidence
  → independent verification
  → acceptance and risk-quality gates
  → adaptive repair or re-planning when needed
  → recovery after restart or lease loss
  → completion and learning extraction
  → natural report in the conversation
```

## Representative domain flows

| Flow | Domain contract | Expected evidence | Verification |
|---|---|---|---|
| Source-backed investigation | Research | Source references, extracted claims, comparison, uncertainty, synthesis | Cross-source or fresh-context review |
| Repository change | Software Engineering | Scope-aware diff, command results, test/build results, artifact provenance | Independent quality gate |
| Formal derivation or proof | Mathematics | Assumptions, transformations, derivation, result, counterexample or edge-case analysis | Independent derivation or substitution check |
| Multi-domain delivery | Mixed Mission | Domain evidence, explicit handoffs, integration artifacts, unresolved assumptions | Domain-specific checks plus cross-domain consistency |

## State and durability guarantees

| Guarantee | Runtime behavior |
|---|---|
| Clarification is not execution | A `needs_clarification` intake returns a natural question and creates no mission. |
| Queueing is not duplicate creation | The unified launcher creates one mission and performs one queue transition. |
| Skill does not grant authority | Role, action, capability, and harness policies remain enforced by the runner. |
| Success requires evidence | Work and mission completion continue to require durable evidence and verification. |
| Repair preserves history | Failed work, artifacts, evidence, retry lineage, and completed work remain available when re-planning. |
| Restart preserves state | Recovery reconciles stale leases and interrupted work before resumption. |
| Reporting is user-facing only | Internal stages and enforcement details remain runtime data, not ordinary assistant prose. |

## Failure continuity

Each lifecycle boundary returns or persists a typed outcome. A provider failure remains a provider failure; a clarification remains a clarification; a blocked capability remains a capability denial; a quality failure remains a quality failure; and a repair plan remains linked to the failed work item.

The integration layer does not swallow failures into a generic success response. It preserves the evidence and status needed for the next repair, recovery, or operator action.

## Phase 14 endpoint

Phase 14 is complete when representative domain fixtures can pass through the unified launch boundary, the existing runner can execute the resulting work graph, durable evidence and verification can satisfy acceptance and risk gates, and failure paths preserve repair and recovery continuity.

This phase does not add new external tools, a new UI application, or a new repository persistence system. It composes and verifies the runtime already established by the preceding phases.

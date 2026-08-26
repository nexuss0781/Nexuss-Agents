---
name: nexuss-workflow-stages
version: 1.0.0
description: Canonical registry for the sixteen Nexuss-Agent workflow stages, their inputs, outputs, completion predicates, and transition paths.
---

# Nexuss-Agent Canonical Stage Registry

## Registry identity

```text
registry: nexuss-workflow-stages
version: 1.0.0
stage_count: 16
```

The stage ID is the stable machine-facing identity. The filename is the human-facing Markdown instruction source. Runtime code, events, prompts, and persistence use the stage ID rather than the display title.

## Stage sequence

```text
receive
→ understand
→ intake
→ form_mission
→ plan
→ decompose_delegate
→ research_inspect
→ design_reason
→ execute
→ observe_adapt
→ verify
→ repair_recover
→ integrate
→ quality_gate
→ complete
→ report_continue
```

The sequence is the default forward path. Re-entry is allowed through a new stage run when evidence, a user continuation, or a failed verification requires earlier work to be revisited.

## Registry

| # | Stage ID | Markdown source | Primary role | Required output |
|---:|---|---|---|---|
| 1 | `receive` | `Stage_01-Receive.md` | Preserve the incoming objective and source context. | Request record. |
| 2 | `understand` | `Stage_02-Understand.md` | Build the intent and outcome model. | Intent model. |
| 3 | `intake` | `Stage_03-Intake.md` | Normalize requirements and traceability. | Mission brief and intake decision. |
| 4 | `form_mission` | `Stage_04-Form-Mission.md` | Create durable mission identity and contract. | Mission contract. |
| 5 | `plan` | `Stage_05-Plan.md` | Form an executable strategy. | Plan and work-item graph. |
| 6 | `decompose_delegate` | `Stage_06-Decompose-and-Delegate.md` | Assign bounded work and create child relationships. | Assignments and delegation records. |
| 7 | `research_inspect` | `Stage_07-Research-and-Inspect.md` | Establish actual state and evidence. | Evidence package and baseline. |
| 8 | `design_reason` | `Stage_08-Design-and-Reason.md` | Select and justify a competent path. | Decision and predicted outcomes. |
| 9 | `execute` | `Stage_09-Execute.md` | Produce observable work and artifacts. | Execution result and artifacts. |
| 10 | `observe_adapt` | `Stage_10-Observe-and-Adapt.md` | Compare predictions with actual results. | Updated model or continuation decision. |
| 11 | `verify` | `Stage_11-Verify.md` | Test the result against the contract. | Verification record. |
| 12 | `repair_recover` | `Stage_12-Repair-and-Recover.md` | Correct or recover from a failure. | Repair result or explicit blocker. |
| 13 | `integrate` | `Stage_13-Integrate.md` | Reconcile outputs into one candidate result. | Integrated result. |
| 14 | `quality_gate` | `Stage_14-Quality-Gate.md` | Independently assess readiness. | Quality decision. |
| 15 | `complete` | `Stage_15-Complete.md` | Persist the accepted mission result. | Completion record. |
| 16 | `report_continue` | `Stage_16-Report-and-Continue.md` | Deliver the result and preserve continuity. | Final report and continuation record. |

## Stage definitions

### 1. `receive`

**Purpose:** Preserve the user’s request before interpretation.

**Inputs:** raw user message, attachments, conversation context, active project, continuing mission references.

**Outputs:** request record, source references, attachment references, initial work-shape classification.

**Completion predicate:** the original input and available context are preserved and traceable.

**Normal next stages:** `understand` or direct conversation response.

### 2. `understand`

**Purpose:** Establish what outcome the user actually wants.

**Inputs:** request record and available context.

**Outputs:** intent model, explicit requirements, inferred assumptions, material unknowns, likely domains, success signals.

**Completion predicate:** the desired outcome and material uncertainty are intelligible enough for intake.

**Normal next stage:** `intake`.

### 3. `intake`

**Purpose:** Normalize the request into a traceable brief.

**Inputs:** intent model, source material, attachments, project references, prior mission references.

**Outputs:** objective, deliverables, requirements, acceptance criteria, constraints, assumptions, domains, required capabilities, risk signals, source references, intake decision.

**Completion predicate:** the brief is source-linked and has one valid decision: `ready_for_planning`, `ready_with_assumptions`, `needs_clarification`, or `blocked`.

**Normal next stages:** `form_mission`, clarification continuation, or blocked handling.

### 4. `form_mission`

**Purpose:** Give the work durable identity and a completion contract.

**Inputs:** normalized brief, owner, project, selected model, runtime context.

**Outputs:** mission record, mission contract, acceptance criteria, completion policy, budget, initial event.

**Completion predicate:** the mission can be loaded by the runtime with a stable identity and contract.

**Normal next stage:** `plan`.

### 5. `plan`

**Purpose:** Convert the mission contract into an executable strategy.

**Inputs:** mission contract, project state, available capabilities, prior evidence.

**Outputs:** plan summary, assumptions, work-item graph, dependencies, role assignments, verification points, expected artifacts.

**Completion predicate:** each work item has a bounded objective, dependencies, acceptance criteria, owner or role, and verification path.

**Normal next stage:** `decompose_delegate`.

### 6. `decompose_delegate`

**Purpose:** Assign bounded work to appropriate agents and create parent-child relationships.

**Inputs:** work-item graph, agent registry, role contracts, capability catalog, budgets.

**Outputs:** agent assignments, child missions where useful, delegation events, leases, inherited authority.

**Completion predicate:** every active work item has a valid scope, role, capability context, expected output, and return path.

**Normal next stage:** `research_inspect` for each executable work item.

### 7. `research_inspect`

**Purpose:** Replace assumption with direct observation and evidence.

**Inputs:** bounded work item, project or source landscape, relevant files, prior evidence.

**Outputs:** baseline, source-backed findings, repository understanding, definitions, unknowns, evidence package.

**Completion predicate:** the next design or execution decision is supported by inspectable evidence.

**Normal next stage:** `design_reason`.

### 8. `design_reason`

**Purpose:** Choose and justify the best competent path.

**Inputs:** evidence package, mission contract, constraints, domain method, acceptance criteria.

**Outputs:** selected approach, alternatives considered, assumptions, prediction, verification method, decision record.

**Completion predicate:** a viable path exists from current evidence to the required result and its verification is defined.

**Normal next stage:** `execute`.

### 9. `execute`

**Purpose:** Produce the intended work through approved capabilities.

**Inputs:** approved work item, selected approach, skills, harnesses, project or research context.

**Outputs:** changes, calculations, research synthesis, artifacts, tool results, operation records, execution events.

**Completion predicate:** an inspectable result or clearly classified execution outcome exists.

**Normal next stages:** `observe_adapt`, `verify`, `repair_recover`, `blocked`, or `cancelled`.

### 10. `observe_adapt`

**Purpose:** Compare predicted behavior with actual behavior and update the path.

**Inputs:** live tool results, intermediate artifacts, predictions, runtime events, work-item state.

**Outputs:** updated working model, continuation decision, revised work item or plan when necessary.

**Completion predicate:** the mission has an evidence-backed continuation path or a classified recovery/escalation state.

**Normal next stages:** `verify`, `design_reason`, `execute`, `repair_recover`, or `plan`.

### 11. `verify`

**Purpose:** Test whether the result satisfies the objective and acceptance criteria.

**Inputs:** result, artifacts, acceptance criteria, predicted outcomes, verification plan.

**Outputs:** verification records, check results, reproducibility evidence, failed checks, acceptance mapping.

**Completion predicate:** criteria are satisfied or a precise repair/re-plan decision is recorded.

**Normal next stages:** `integrate`, `repair_recover`, or `quality_gate`.

### 12. `repair_recover`

**Purpose:** Restore forward progress after failure or mismatch.

**Inputs:** failure record, diagnosis, prior attempts, recovery assets, acceptance criteria.

**Outputs:** repair attempt, changed strategy, recovery action, new evidence, or explicit blocker.

**Completion predicate:** the repaired state is ready for verification or the blocker is durable and precise.

**Normal next stages:** `research_inspect`, `design_reason`, `execute`, `verify`, or `plan`.

### 13. `integrate`

**Purpose:** Reconcile specialist, executor, research, calculation, and verification outputs.

**Inputs:** completed work-item outputs, evidence, artifacts, diffs, quality requirements, mission contract.

**Outputs:** integrated candidate result, conflict resolution, acceptance mapping, remaining uncertainty.

**Completion predicate:** one coherent candidate result exists with provenance and no unexplained conflict.

**Normal next stage:** `quality_gate`.

### 14. `quality_gate`

**Purpose:** Independently decide whether the integrated result is ready.

**Inputs:** candidate result, acceptance criteria, evidence, artifacts, verification records, risk level.

**Outputs:** quality decision, reviewer identity, independence mode, passed checks, failed checks, next transition.

**Completion predicate:** the result is accepted, repair is required, the mission is blocked, or it is cancelled through a persisted quality decision.

**Normal next stages:** `complete`, `repair_recover`, `plan`, `blocked`, or `cancelled`.

### 15. `complete`

**Purpose:** Persist the accepted result as a completed mission.

**Inputs:** accepted quality decision, completed dependencies, final artifacts, evidence, mission contract.

**Outputs:** completion record, final state, provenance, learning candidates, completion event.

**Completion predicate:** all required criteria, evidence, artifacts, dependencies, and persistence requirements are satisfied.

**Normal next stage:** `report_continue`.

### 16. `report_continue`

**Purpose:** Deliver an accurate user-facing result and preserve continuation.

**Inputs:** completed mission, integrated result, quality decision, artifacts, evidence, assumptions.

**Outputs:** final report, artifact references, commit or source references, continuation record.

**Completion predicate:** the user has a usable result and the durable runtime can support follow-up, replay, or related work.

**Normal next stage:** a new `receive` stage for new input or a continuation linked to the completed mission.

## Re-entry rules

A mission may revisit a stage only by creating a new stage run. The prior stage run remains immutable. Re-entry requires one of:

```text
new evidence
user correction
changed project state
failed verification
quality-gate repair decision
recovery action
new acceptance criterion
```

The runtime records the reason for re-entry and links the new run to its parent run.
"

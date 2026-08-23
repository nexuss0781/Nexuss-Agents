# Nexuss-Agent Full Engineering Roadmap

## 1. Engineering Objective

The engineering objective is to evolve Nexuss-Agent from a persistent model playground into a **general autonomous-builder runtime**. The implementation must allow one user goal to become a durable mission, a recursive work graph, coordinated agent execution, tool activity, independent verification, recovery, final delivery, and validated reusable knowledge.

The implementation should proceed in vertical slices. We should never build a large collection of tables, prompts, and UI screens that are not connected to a complete executable path.

> **Every major phase must end with a working, testable capability that survives refresh, failure, cancellation, and restart.**

## 2. Engineering Principles

| Principle | Engineering meaning |
|---|---|
| Runtime before appearance | The server owns execution. The UI observes and controls it; React state is never the source of truth for an autonomous run. |
| Contracts before agents | Mission, agent, skill, harness, quality, artifact, and learning contracts are defined before large implementations. |
| Durable by default | Mission state, events, checkpoints, artifacts, and quality results persist in Paradox. |
| Recursive but bounded | Agents may create child work, but recursion has depth, budget, timeout, and dependency limits. |
| Evidence over confidence | Completion requires acceptance evidence, not an agent’s claim that it is finished. |
| Independent verification | The producer and verifier have separate responsibilities and preferably separate execution paths. |
| Recoverable failure | Failed work becomes structured evidence for repair, not deleted history or an opaque retry. |
| Safe autonomy | The system proceeds without routine interruption but respects permission, security, destructive-action, and budget boundaries. |
| Compounding knowledge | Experience becomes memory, skill, or shortcut only after validation, scope assignment, versioning, and replay where applicable. |
| Provider-neutral runtime | Models are replaceable resources selected by capability; the mission runtime must not depend on one model brand or provider format. |

## 3. Target Repository Organization

The first implementation should introduce a server-side mission package without disrupting the existing workspace and playground code.

```text
server/
├── mission/
│   ├── types.ts              # Runtime contracts and discriminated unions
│   ├── stateMachine.ts       # Guarded state transitions
│   ├── store.ts              # Paradox persistence and ownership checks
│   ├── events.ts             # Normalized event journal
│   ├── checkpoints.ts        # Resume state and idempotency
│   ├── runner.ts             # Server-owned execution loop
│   ├── orchestrator.ts       # Planning and recursive delegation
│   ├── agents.ts             # Role contracts and agent execution
│   ├── harness.ts             # Common tool-harness interface
│   ├── quality.ts             # Independent verification
│   ├── learning.ts            # Experience extraction and promotion
│   └── errors.ts              # Typed failure classification
├── mission.router.ts          # Mission tRPC procedures
└── playgroundStream.ts        # Existing normalized model stream

client/src/
├── components/
│   ├── MissionRunDrawer.tsx
│   ├── MissionTimeline.tsx
│   ├── MissionArtifacts.tsx
│   └── MissionControls.tsx
└── pages/Home.tsx             # Chat-to-mission entry integration

docs/
├── Nexuss-AGI-Builder-Workflow.md
├── Nexuss-Full-Autonomous-Workflow.md
└── Nexuss-Full-Engineering-Roadmap.md
```

The exact directory names can change to match repository conventions, but the separation between persistence, state, execution, harnesses, verification, learning, and UI should remain.

## 4. Phase One — Runtime Constitution and Contracts

### Objective

Define the stable interfaces that every later component uses. This phase prevents the platform from becoming a collection of incompatible agent prompts.

### Engineering work

Create typed contracts for:

```text
Mission
MissionContract
WorkItem
WorkDependency
AgentAssignment
HarnessRequest
HarnessResult
MissionEvent
Checkpoint
Artifact
Evidence
QualityGate
QualityResult
Experience
Memory
Skill
Shortcut
Policy
ExecutionBudget
```

Define the system constitution separately from mission data. The constitution describes behavior such as inspecting reality, preserving evidence, continuing safely, verifying independently, recovering from failure, and promoting only validated learning. The mission contract describes the current goal and its acceptance criteria.

Define version fields on all mutable runtime records. Define idempotency keys for work-item execution, artifact creation, and external side effects.

### Acceptance gate

A contract-level test can create a mission, assign a work item, record an event, create a checkpoint, attach an artifact, record a quality result, and close the mission without any model provider or UI dependency.

## 5. Phase Two — Paradox Persistence and Ownership

### Objective

Make the autonomous runtime durable and user-scoped.

### Engineering work

Add Paradox persistence for:

| Record | Required fields |
|---|---|
| Mission | ID, owner, project, goal, contract version, status, parent mission, budget, timestamps |
| Work item | Mission, parent, title, role, status, dependencies, attempts, acceptance criteria |
| Event | Mission, work item, event type, actor, safe payload, sequence, timestamp |
| Checkpoint | Mission, version, active work item, next action, state snapshot, created timestamp |
| Artifact | Mission, work item, path or object reference, type, checksum, provenance |
| Evidence | Artifact or event reference, source, claim, validation status |
| Quality gate | Work item, checks, verifier, status, evidence, failure class |
| Agent lease | Work item, owner, lease expiration, attempt, heartbeat |
| Experience | Mission, observations, outcome, evidence, scope, promotion status |
| Knowledge object | Type, domain, version, confidence, provenance, invalidation condition |

Every query must apply owner and project boundaries. No client-provided mission ID should be trusted without an ownership check. Event payloads must use a safe schema and exclude API keys, cookies, session tokens, and unbounded sensitive output.

Add indexes for owner, project, mission status, parent mission, active leases, event sequence, and knowledge retrieval fields.

### Acceptance gate

A persistence test must prove that a mission and all related records survive reload, cannot be read by another owner, and preserve event ordering and checkpoint versions.

## 6. Phase Three — Guarded Mission State Machine

### Objective

Make mission progress explicit, valid, and recoverable.

### Engineering work

Implement guarded transitions such as:

```text
created → queued → planning → planned → executing
executing → verifying
verifying → completed
verifying → repairing
repairing → executing
executing/verifying/repairing → paused
executing/verifying/repairing → stopped
planning/executing/verifying/repairing → failed
paused → executing
failed → queued or repairing
```

Each transition must:

1. Verify the current status.
2. Verify the record version.
3. Verify policy and ownership.
4. Update the version atomically.
5. Append an event.
6. Save a checkpoint.
7. Release or renew any agent lease.

Do not allow arbitrary “set status” mutations from the client. Expose commands such as `pauseMission`, `resumeMission`, `stopMission`, `retryMission`, and `repairMission` that enforce transition rules.

### Acceptance gate

State-machine tests must reject invalid transitions, stale versions, unauthorized owners, duplicate commands, and resume operations with incompatible checkpoints.

## 7. Phase Four — Mission Runner and Checkpoint Resume

### Objective

Create the server-owned execution loop.

### Engineering work

Implement a runner that:

```text
load mission
  → load latest checkpoint
  → claim next executable work item
  → execute assigned agent/harness
  → persist result and evidence
  → update graph
  → save checkpoint
  → invoke quality gate
  → repair or advance
```

The runner must not depend on a browser tab remaining open. It should use a lease and heartbeat so a crashed worker becomes recoverable. It should use bounded retries and distinguish retryable, repairable, blocked, cancelled, and terminal failures.

The runner must protect against duplicate work. Every execution attempt receives an idempotency key. If a worker restarts after a tool completed but before the result was recorded, the runner must reconcile the operation before repeating it.

### Acceptance gate

A test starts a mission, interrupts the runner after a checkpoint, reloads the process, and proves that execution resumes from the checkpoint without duplicating the completed work item or artifact.

## 8. Phase Five — Principal Orchestrator and Recursive Work Graph

### Objective

Convert a goal into a dependency-aware hierarchy of work.

### Engineering work

Implement the principal orchestrator with five responsibilities:

1. Interpret the user goal into a mission contract.
2. Load relevant project context, memories, skills, shortcuts, and environment facts.
3. Create a dependency graph with acceptance criteria.
4. Allocate bounded sub-orchestrators and specialist agents.
5. Re-plan when evidence invalidates the current strategy.

A work item may create child work only when the child has an independent objective, dependencies, output, and verification method. Add maximum recursion depth, maximum child count, total token budget, total tool budget, and execution timeout.

The orchestrator should record assumptions and test them. It should prefer reversible actions and safe inference. It should ask only when blocked by missing information that cannot be inferred, or when the next action is high-impact, irreversible, or permission-sensitive.

### Acceptance gate

A mission test must turn one coding objective into a root mission, at least one child work item, a dependency graph, agent assignments, and a re-plan after a simulated failed assumption.

## 9. Phase Six — Agent Roles and Model Routing

### Objective

Provide specialized responsibility without hard-coding one model or persona into the runtime.

### Engineering work

Implement role contracts for:

| Role | Responsibility |
|---|---|
| Principal orchestrator | Owns the mission and final completion decision |
| Architect | Defines interfaces, dependencies, constraints, and implementation order |
| Builder | Produces code, configuration, content, and artifacts |
| Environment operator | Inspects and operates terminal, browser, services, and deployment |
| Evidence analyst | Gathers and links evidence to claims and acceptance criteria |
| Quality verifier | Independently tests and challenges output |
| Security reviewer | Checks permissions, secrets, data boundaries, and dangerous actions |
| Integrator | Merges verified work and prepares delivery |
| Experience librarian | Extracts reusable knowledge from the mission |

Add model routing by capability. The runtime should ask the provider adapter whether a model supports streaming, tools, structured output, reasoning, vision, or long context. The routing decision and reason should be recorded in the mission event journal.

### Acceptance gate

A routing test proves that different roles can use different models while consuming the same normalized mission and event contracts.

## 10. Phase Seven — Harness and Tool Layer

### Objective

Make tools controllable, auditable, cancellable, and reusable across skills.

### Engineering work

Define the common harness interface:

```ts
type Harness = {
  id: string;
  capabilities: string[];
  permissions: Permission[];
  execute(request: HarnessRequest, signal: AbortSignal): Promise<HarnessResult>;
};
```

Implement the first harnesses in this order:

1. **Repository inspection harness** for safe file and project-state inspection.
2. **Terminal/WebDev builder harness** for bounded edits, tests, builds, and artifact capture.
3. **Browser verification harness** for real interaction and visual-state validation.
4. **Search and webpage harness** for external evidence and structured extraction.
5. **Deployment harness** with stronger policy controls and explicit side-effect reporting.

Each harness must define input validation, workspace boundaries, timeout, cancellation, retry behavior, output limits, artifact handling, and side-effect classification.

### Acceptance gate

A harness test proves that a tool request is validated, executed, cancelled, recorded, and replayed safely without exposing secret values in events or logs.

## 11. Phase Eight — Quality, Repair, and Acceptance

### Objective

Prevent the builder from declaring success without evidence.

### Engineering work

Implement quality gates for:

```text
structure
behavior
regression
visual state
security
operational recovery
mission acceptance
```

A quality gate receives the mission contract, work-item output, artifacts, and evidence. It returns pass, fail, or inconclusive with structured checks and failure classes.

Failures create repair work items. A repair attempt must include the failed evidence, diagnosis, changed strategy, and new verification result. Repeated failures should trigger a bounded re-plan rather than infinite retries.

### Acceptance gate

The first autonomous coding mission must intentionally fail one check, create a repair item, change the implementation, pass the check, and preserve both the failure and repair evidence.

## 12. Phase Nine — Mission Event Stream and Run UI

### Objective

Expose durable runtime progress without polluting the chat transcript.

### Engineering work

Create a normalized event stream for:

```text
mission status
planning progress
agent assignments
work-item changes
harness actions
artifact creation
quality checks
repair attempts
checkpoint saves
pause/resume/stop
completion
```

Build the minimal Run Drawer only after the server runtime works. It should show mission status, current work item, active agent role, latest tool summary, quality state, checkpoint time, artifacts, failures, and controls.

The chat should show the user’s request and final result. Internal orchestration events, hidden instructions, credentials, and raw chain-of-thought should remain outside the conversation.

### Acceptance gate

A browser test starts a mission, refreshes the page, and confirms that the Run Drawer rehydrates the same mission, current state, events, artifact links, and controls.

## 13. Phase Ten — Experience, Memory, Skills, and Shortcuts

### Objective

Make the platform improve through validated practice.

### Engineering work

Implement a post-mission learning pipeline:

```text
mission trace
  → episode
  → observations
  → evidence validation
  → experience
  → memory/skill/shortcut candidate
  → replay or review
  → versioned promotion
```

Experience is a record of what happened. Memory is a scoped reusable fact. A skill is a repeatable procedure with inputs, outputs, tools, and tests. A shortcut is a parameterized workflow composed from trusted skills.

Add domain and subdomain classification. Store provenance, scope, confidence, validation date, version, dependencies, and invalidation conditions. Never silently replace a trusted skill with an agent-generated draft.

### Acceptance gate

A completed mission produces an experience record. A replay test validates one skill candidate. Only after replay succeeds can the skill become available in future mission context.

## 14. Phase Eleven — New-Project Context Initialization

### Objective

Ensure every new project begins with useful accumulated capability.

### Engineering work

Create a context loader that classifies the new project and retrieves:

```text
project rules
relevant domain knowledge
compatible skills
trusted shortcuts
validated memories
known failure patterns
available tools and connectors
```

The loader should use relevance, scope, version compatibility, and confidence. It should not load all historical traces into the model context.

### Acceptance gate

A new project initialization test proves that relevant knowledge is loaded, irrelevant knowledge is excluded, and stale or invalidated skills are not used.

## 15. Phase Twelve — Security, Policy, and Autonomy Controls

### Objective

Allow strong autonomy without uncontrolled side effects.

### Engineering work

Implement policy declarations for tools and actions:

| Policy category | Examples |
|---|---|
| Read permissions | Repository read, webpage read, workspace search |
| Write permissions | File edit, database mutation, deployment change |
| Sensitive actions | Credential use, external publication, deletion, payment, communication |
| Data boundaries | Private code, personal data, provider retention, external transmission |
| Resource limits | Token, time, tool-call, recursion, and artifact budgets |
| Recovery policy | Retry, repair, pause, escalation, and terminal failure |

Keep credentials in encrypted server-side storage. Pass only the minimum secret capability required to a harness. Redact logs and events. Add audit events for permission decisions and sensitive actions.

### Acceptance gate

Security tests prove that an unauthorized agent cannot invoke a restricted harness, a secret is not written to event storage, and a stopped mission cannot continue through a stale worker.

## 16. Phase Thirteen — Benchmark and Evaluation System

### Objective

Measure real autonomous capability rather than prompt quality.

### Engineering work

Create repeatable mission fixtures across:

```text
repository change
bug diagnosis
frontend implementation
backend persistence
browser validation
deployment preparation
document generation
provider failure recovery
refresh/resume recovery
skill replay
```

Measure completion rate, acceptance-gate pass rate, repair success, duplicate-side-effect rate, resume success, time, model/tool cost, user interruptions, artifact quality, and knowledge reuse.

Store benchmark runs as versioned artifacts. Every runtime release should run the benchmark suite before publication.

### Acceptance gate

The platform must demonstrate that a later run can reuse a promoted skill or memory and improve a measured outcome without bypassing verification.

## 17. Phase Fourteen — Deployment and Operations

### Objective

Operate the runtime reliably in the deployed environment.

### Engineering work

Configure Render and Paradox for:

```text
server-owned mission execution
persistent gateway access
worker leases and heartbeats
structured logs
health checks
safe shutdown
retryable provider failures
migration/version checks
```

Decide whether the first mission runner runs inside the existing server process or as a dedicated worker. The initial vertical slice may share the server process if leases and graceful shutdown are implemented correctly; a dedicated worker becomes preferable as concurrent missions increase.

Add operational diagnostics with request IDs, mission IDs, work-item IDs, agent roles, provider status, and failure classes. Never log prompts or credentials by default.

### Acceptance gate

A deployed smoke test creates a mission, observes progress, refreshes the browser, stops or resumes the mission, and retrieves the final artifact and evidence.

## 18. First Vertical Slice to Implement

The first complete mission should be **Autonomous Repository Change**.

```text
user gives coding objective
  → mission contract created
  → repository context loaded
  → work graph planned
  → builder harness edits code
  → events and checkpoint persisted
  → quality harness runs checks
  → repair loop handles one failure
  → verified artifact delivered
  → experience extracted
```

This vertical slice should use the existing encrypted model provider and streaming infrastructure. It should not require the full future knowledge graph, every tool, or a complex UI.

### First-slice definition of done

The first slice is complete when a user can give a bounded coding objective and Nexuss-Agent can:

1. Create a durable mission.
2. Produce a plan and work graph.
3. Execute one repository change through a bounded harness.
4. Stream normalized progress.
5. Persist events, checkpoints, and artifacts.
6. Run independent tests and build checks.
7. Repair at least one failed check.
8. Stop and resume without duplicate work.
9. Deliver a verified result.
10. Record the mission as reusable experience.

## 19. Engineering Delivery Protocol

Every implementation command should follow the same engineering loop:

```text
interpret objective
  → inspect repository
  → define contract
  → implement smallest vertical slice
  → add focused tests
  → run type/build/integration checks
  → inspect diff and secrets
  → update checklist
  → commit focused change
  → push to master
  → report exact evidence
```

Each phase should be divided into small commits when possible. A commit should represent one coherent capability, not a mixture of architecture, unrelated UI, formatting, and experimental code.

The completion documentation should be written only after the feature is implemented and benchmarked. It should describe the actual runtime contracts, persisted records, workflows, screenshots, tests, deployment evidence, and known limitations.

## 20. Final Engineering Sequence

```text
1. Contracts and constitution
2. Paradox mission persistence
3. Guarded state machine
4. Event journal and checkpoints
5. Server mission runner
6. Principal orchestrator
7. Recursive work graph
8. Agent role contracts and model routing
9. Terminal/WebDev harness
10. Independent quality gates
11. Repair and recovery
12. Browser and event-stream UI
13. Experience extraction
14. Memory and skill promotion
15. Shortcut generation and replay
16. Domain-aware context loading
17. Security and policy hardening
18. Benchmarks and evaluation
19. Render/Paradox deployment operations
20. Completion documentation
```

The correct starting implementation is therefore the **Mission Kernel vertical slice**, but the full engineering program is the sequence above. Each later capability plugs into the same durable runtime instead of becoming a separate product mode.

> **The end state is not a larger prompt. It is a verified, persistent, recursively orchestrated execution system that compounds capability from every completed mission.**

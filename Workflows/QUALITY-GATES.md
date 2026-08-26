# Independent Quality and Risk Gates

## Purpose

Quality is a runtime decision, not a model assertion. A mission may complete only after the evidence and verification records satisfy the risk profile attached to its mission contract.

## Risk matrix

| Mission risk | Minimum verification independence | Passing verification records | Required evidence |
|---|---|---:|---|
| Low | Fresh context | 0 | Domain and acceptance evidence when declared |
| Medium | Blind review | 1 | `quality_check` |
| High | Separate agent | 2 | `quality_check`, `security_review` |
| Critical | Separate model | 3 | `quality_check`, `security_review` |

Higher-ranked verification modes may satisfy a lower threshold. A self-check never satisfies a risk profile that requires an independent verifier.

## Producer and verifier separation

The producer records its output and supporting observations. The quality role verifies the output through a separate execution path, fresh context, independent agent, separate model, or runtime reproduction. A producer cannot satisfy the independent verification requirement merely by returning `verified: true`.

## Evidence rules

A passing verification must reference durable evidence. A quality check records the exact check class, command or method, result, duration, and bounded output summary. Security review records the security-review outcome and its provenance. Missing evidence is a quality failure, not an invitation to infer success.

## Runtime behavior

The live runner evaluates the mission risk profile after work items and evidence are durable and before the final completed transition. If a required evidence kind or verification threshold is missing, the runner transitions through `verifying` and records a typed quality failure rather than completing silently.

| Failure code | Meaning |
|---|---|
| `MISSION_EVIDENCE_INCOMPLETE` | A quality work item claimed completion without evidence-backed independent verification. |
| `MISSION_ACCEPTANCE_INCOMPLETE` | Required mission acceptance criteria lack evidence or verification. |
| `MISSION_QUALITY_GATE_INCOMPLETE` | The mission risk profile lacks required evidence, security review, or independent verification count. |

## Domain-specific quality

Software engineering uses type, test, build, diff, and security checks as appropriate. Research requires source traceability, comparison, and uncertainty handling. Mathematics requires formal assumptions, derivation or proof checks, and independent validation. Mixed missions require every domain gate plus cross-domain consistency checks.

The risk gate strengthens domain contracts; it does not replace their acceptance criteria. Every domain must still declare what constitutes a valid result and what evidence supports it.

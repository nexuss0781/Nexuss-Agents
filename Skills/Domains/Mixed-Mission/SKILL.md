---
version: 1.0.0
---

# Mixed Mission Skill

## Identity

This skill composes multiple domain tracks into one mission while preserving each track’s assumptions, evidence, authority, and verification obligations.

## Mission Fit

Use it when a mission combines research, software engineering, mathematics, analysis, experimentation, or other domain contracts and requires an integrated result.

## Required Inputs

The mission must provide a global objective, participating domains, cross-domain dependencies, shared constraints, handoff artifacts, and integration acceptance criteria.

## Operating Procedure

Identify the participating domains. Create bounded tracks and explicit handoff records. Execute dependencies in order, reconcile incompatible assumptions, integrate results, and perform both domain-specific and cross-domain verification.

## Allowed Capabilities

Use the capabilities permitted by the selected child skills. Composition itself performs read-only coordination and does not widen the authority of any child role or harness.

## Authority and Side Effects

Coordination uses `mission_owner` authority for planning and delegation actions. Child work remains subject to its own role authority, action policy, tool policy, and runner budget.

## Expected Outputs

Produce an integrated result, domain findings, handoff records, conflict resolutions, an evidence matrix, verification results, and unresolved assumptions.

## Evidence Requirements

Preserve provenance for every domain result. Link source findings to design decisions, mathematical claims to derivations, implementation artifacts to requirements, and all final claims to verification evidence.

## Verification Requirements

Run each domain’s required checks and add cross-domain consistency checks. Verify that handoffs were consumed as stated and that integration did not change assumptions silently.

## Failure Classification

Classify handoff mismatch, incompatible assumptions, domain conflict, missing evidence, integration failure, and unresolved dependency. Re-plan when the global mission or dependency graph must change.

## Repair and Retry Strategy

A retry must reopen the affected domain track, revise the handoff contract, change the integration strategy, or re-plan the dependency graph. Preserve the original domain result and explain the changed condition.

## Handoff and Composition

Consume research findings, mathematical specifications, engineering changes, and quality results. Produce a unified evidence matrix and explicit integration decision for the final verifier.

## Completion Checklist

All participating domain tracks have completed; handoffs are traceable; conflicts are resolved or explicitly retained; domain checks pass; cross-domain checks pass; and the integrated result satisfies the mission contract.

## Runtime Contract Metadata

```json
{
  "id": "domain.mixed_mission",
  "version": "1.0.0",
  "title": "Mixed Mission Skill",
  "domain": "mixed_mission",
  "maturity": "validated",
  "description": "Coordinate multiple domain tracks while preserving explicit handoffs, provenance, and cross-domain verification.",
  "missionSignals": ["mixed", "end to end", "research and build", "prove and implement", "integrate domains", "cross-domain"],
  "supportedStages": ["understand", "intake", "form_mission", "plan", "decompose_delegate", "research_inspect", "design_reason", "execute", "observe_adapt", "verify", "repair_recover", "integrate", "quality_gate", "complete", "report_continue"],
  "inputs": [{"id":"domain_tracks","description":"Global objective, domain tracks, dependencies, and shared constraints","required":true,"acceptedKinds":["mission_contract","work_graph","domain_result"],"sourceRequirements":["mission_record","project_state","agent_observation"]}],
  "procedure": [{"id":"decompose","stage":"decompose_delegate","instruction":"Identify domains, dependencies, roles, and handoff artifacts.","required":true},{"id":"integrate","stage":"integrate","instruction":"Reconcile domain outputs and resolve cross-domain conflicts.","required":true},{"id":"verify","stage":"quality_gate","instruction":"Run domain and cross-domain verification.","required":true}],
  "actions": ["inspect", "read", "search", "calculate", "design", "research"],
  "authority": "mission_owner",
  "sideEffects": ["read_only", "network_read"],
  "allowedRoles": ["principal_orchestrator", "sub_orchestrator", "integrator", "quality_gate", "quality", "builder", "repository_builder", "architect", "repository_architect", "security_auditor"],
  "allowedHarnesses": ["mission_runtime", "repository_inspection", "repository_verification", "research", "terminal"],
  "outputs": [{"id":"integrated_result","description":"Integrated domain result with handoff and verification matrix","required":true,"artifactKinds":["integration_result","verification_matrix"],"evidenceKinds":["handoff","domain_result","cross_domain_check"]}],
  "evidence": {"requiredKinds":["handoff","domain_result","cross_domain_check"],"minimumStrength":"strong","provenanceRequirements":["source domain","input and output references","integration observation"],"claimTraceability":true},
  "verification": {"methods":["domain-specific checks","handoff validation","cross-domain consistency review","independent integration review"],"minimumIndependence":"separate_agent","acceptanceChecks":["all required tracks completed","handoffs are traceable","cross-domain checks pass"],"producerMayVerify":false},
  "failure": {"failureClasses":["handoff_mismatch","incompatible_assumptions","domain_conflict","missing_evidence","integration_failure","unresolved_dependency"],"retryable":["integration_failure"],"repairable":["handoff_mismatch","missing_evidence"],"replanRequired":["incompatible_assumptions","domain_conflict","unresolved_dependency"],"escalationConditions":["domain contracts disagree materially","required evidence cannot be reconciled","integration criteria remain unsatisfied"],"changedStrategyRequired":true},
  "composition": {"consumes":["research_findings","mathematical_result","implementation_artifacts","quality_results"],"produces":["integrated_result","evidence_matrix","integration_decision"],"compatibleDomains":["research","software_engineering","mathematics","mixed_mission"],"handoffRequirements":["domain provenance","assumptions","verification status","conflict resolution"]}
}
```

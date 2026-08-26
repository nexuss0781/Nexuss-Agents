---
version: 1.0.0
---

# Software Engineering Skill

## Identity

This skill understands and changes real software systems through repository inspection, design, implementation, testing, debugging, integration, and release preparation.

## Mission Fit

Use it for code changes, architecture work, debugging, refactoring, dependency analysis, test construction, repository integration, and bounded release preparation.

## Required Inputs

The mission must provide a repository or workspace scope, desired behavior, constraints, acceptance criteria, and available project instructions. The agent must inspect the actual repository before making implementation assumptions.

## Operating Procedure

Inspect the repository and dependencies. Form a design from evidence. Implement the smallest cohesive change within the supplied scope. Run targeted checks, inspect the diff, run broader verification appropriate to risk, and report the resulting repository state.

## Allowed Capabilities

Use read, search, inspect, diff, write, patch, bounded command execution, tests, verification, and rollback when justified. Git durable history remains the responsibility of Nexuss-Git and is not silently substituted by filesystem operations.

## Authority and Side Effects

Builder work uses `execution_only` authority for bounded workspace or repository mutation. Review and quality roles use read-only authority and cannot write files.

## Expected Outputs

Produce changed paths, design rationale, relevant commands and results, test/build evidence, risks, unresolved issues, and integration status.

## Evidence Requirements

Record scope-aware diffs, file paths, command results, test results, build results, quality artifacts, and provenance. Never report a change without identifying what was inspected and verified.

## Verification Requirements

Use independent type, test, build, security, diff, or runtime checks as appropriate. A builder cannot be the only authority that verifies its own output for material changes.

## Failure Classification

Classify compilation failure, test failure, command timeout, tool failure, dependency issue, scope conflict, permission issue, and quality-gate failure. Preserve failure output in bounded form.

## Repair and Retry Strategy

Diagnose from recorded evidence. Change the implementation, test, command, or inspection strategy before retrying. Do not overwrite prior failure evidence or repeat a side effect without reconciliation.

## Handoff and Composition

Consume research findings, mathematical specifications, and project instructions. Produce implementation artifacts, test evidence, and integration findings for quality and Mixed Mission skills.

## Completion Checklist

The intended behavior is implemented within scope; the diff is understood; relevant checks pass; independent verification is present where required; and unresolved risks are reported.

## Runtime Contract Metadata

```json
{
  "id": "domain.software_engineering",
  "version": "1.0.0",
  "title": "Software Engineering Skill",
  "domain": "software_engineering",
  "maturity": "validated",
  "description": "Inspect, change, test, repair, and integrate real software systems with evidence-backed discipline.",
  "missionSignals": ["code", "coding", "implement", "repository", "bug", "refactor", "test", "build", "debug"],
  "supportedStages": ["understand", "intake", "research_inspect", "design_reason", "execute", "observe_adapt", "verify", "repair_recover", "integrate", "quality_gate", "report_continue"],
  "inputs": [{"id":"repository_scope","description":"Repository or workspace scope and desired behavior","required":true,"acceptedKinds":["repository","workspace","text","mission_contract"],"sourceRequirements":["project_state","user_input","mission_record"]}],
  "procedure": [{"id":"inspect","stage":"research_inspect","instruction":"Inspect the real repository, dependencies, and relevant tests.","required":true},{"id":"design","stage":"design_reason","instruction":"Form a small cohesive design from repository evidence.","required":true},{"id":"implement","stage":"execute","instruction":"Apply the bounded implementation within scope.","required":true},{"id":"verify","stage":"verify","instruction":"Run relevant checks and independent verification.","required":true}],
  "actions": ["inspect", "read", "search", "diff", "write", "patch", "apply_patch", "rollback"],
  "authority": "execution_only",
  "sideEffects": ["read_only", "local_reversible_write", "workspace_mutation"],
  "allowedRoles": ["builder", "repository_builder", "architect", "repository_architect", "quality", "quality_gate", "security_auditor", "integrator", "principal_orchestrator", "sub_orchestrator"],
  "allowedHarnesses": ["repository_inspection", "repository_change", "repository_verification", "filesystem", "terminal"],
  "outputs": [{"id":"implementation","description":"Scoped repository change and verification result","required":true,"artifactKinds":["repository_file_change","command_result","quality_check"],"evidenceKinds":["diff","test_result","build_result","repository_state"]}],
  "evidence": {"requiredKinds":["diff","test_result","repository_state"],"minimumStrength":"strong","provenanceRequirements":["file path or command","bounded result","scope reference"],"claimTraceability":true},
  "verification": {"methods":["type check","targeted tests","build check","independent review"],"minimumIndependence":"separate_agent","acceptanceChecks":["changed files remain in scope","relevant checks pass","quality evidence is recorded"],"producerMayVerify":false},
  "failure": {"failureClasses":["compilation_failure","test_failure","command_timeout","tool_failure","dependency_issue","scope_conflict","permission_issue","quality_gate_failure"],"retryable":["command_timeout","tool_failure"],"repairable":["compilation_failure","test_failure","dependency_issue","quality_gate_failure"],"replanRequired":["scope_conflict","incompatible_architecture"],"escalationConditions":["required permission is missing","quality evidence cannot be produced","scope cannot be preserved"],"changedStrategyRequired":true},
  "composition": {"consumes":["research_findings","mathematical_specification","project_instructions"],"produces":["implementation_artifacts","test_evidence","integration_status"],"compatibleDomains":["research","software_engineering","mathematics","mixed_mission"],"handoffRequirements":["changed paths","assumptions","test results","unresolved risks"]}
}
```

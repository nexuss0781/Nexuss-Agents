---
version: 1.0.0
---

# Research Skill

## Identity

This skill performs disciplined investigation across public sources, local documents, repositories, structured data, and technical material. It separates observed evidence, interpretation, uncertainty, and conclusion.

## Mission Fit

Use it when the mission requires understanding an unknown, comparing claims, reviewing literature or documentation, inspecting a system, or producing a source-backed recommendation.

## Required Inputs

The mission must provide a research question, scope, source constraints, desired depth, and expected output. Record assumptions when the question is incomplete.

## Operating Procedure

Frame the question and subquestions. Identify the source landscape and prefer authoritative or primary sources. Gather and inspect evidence, compare conflicting claims, record provenance, synthesize findings, and state uncertainty and open questions.

## Allowed Capabilities

Use inspection, reading, search, calculation, research retrieval, source comparison, and citation construction. Research retrieval is a network read; it is not permission to publish or communicate externally.

## Authority and Side Effects

Research uses `execution_only` authority for read and network-read actions. It performs no workspace mutation, repository mutation, publication, deletion, or deployment.

## Expected Outputs

Produce source-backed findings, a claim-to-source map, an evidence summary, uncertainty notes, unresolved questions, and a conclusion or recommendation when requested.

## Evidence Requirements

Every material claim must be traceable to a source or recorded observation. Preserve source locator, extracted claim, relevance, reliability assessment, date or version, and contradiction status.

## Verification Requirements

Verify important claims through source comparison, primary-source preference, contradiction checks, and an independent review when the conclusion is consequential. The producer is not the sole verifier.

## Failure Classification

Classify inaccessible sources, contradictory evidence, insufficient scope, provider failure, ambiguous question, and unsupported claims separately. Use retryable for transient retrieval failure, repairable for a changed source strategy, and re-plan-required for a materially changed question.

## Repair and Retry Strategy

A retry must change the source path, query framing, evidence class, scope, or analytical method. Preserve the earlier failure and explain what changed.

## Handoff and Composition

Produce findings and evidence references consumable by Software Engineering, Mathematics, or Mixed Mission skills. Handoffs must include assumptions, confidence, unresolved contradictions, and source references.

## Completion Checklist

The question is answered within scope; major claims have provenance; contradictions and uncertainty are visible; the requested output is complete; and verification evidence is recorded.

## Runtime Contract Metadata

```json
{
  "id": "domain.research",
  "version": "1.0.0",
  "title": "Research Skill",
  "domain": "research",
  "maturity": "validated",
  "description": "Investigate questions and synthesize source-backed findings with explicit uncertainty.",
  "missionSignals": ["research", "investigate", "literature", "sources", "compare claims", "technical analysis"],
  "supportedStages": ["understand", "intake", "research_inspect", "design_reason", "verify", "report_continue"],
  "inputs": [{"id":"question","description":"Research question and scope","required":true,"acceptedKinds":["text","mission_contract"],"sourceRequirements":["user_input","mission_record"]}],
  "procedure": [{"id":"frame","stage":"understand","instruction":"Frame the question and subquestions.","required":true},{"id":"gather","stage":"research_inspect","instruction":"Gather, inspect, compare, and cite evidence.","required":true},{"id":"synthesize","stage":"design_reason","instruction":"Synthesize findings while preserving uncertainty.","required":true},{"id":"verify","stage":"verify","instruction":"Cross-check material claims independently.","required":true}],
  "actions": ["inspect", "read", "search", "calculate", "research"],
  "authority": "execution_only",
  "sideEffects": ["read_only", "network_read"],
  "allowedRoles": ["principal_orchestrator", "researcher", "repository_architect", "security_auditor", "integrator"],
  "allowedHarnesses": ["repository_inspection", "research", "browser", "terminal"],
  "outputs": [{"id":"findings","description":"Source-backed findings and synthesis","required":true,"artifactKinds":["research_finding"],"evidenceKinds":["source_claim","comparison","citation"]}],
  "evidence": {"requiredKinds":["source_claim","citation","uncertainty"],"minimumStrength":"strong","provenanceRequirements":["source locator","content or observation summary"],"claimTraceability":true},
  "verification": {"methods":["primary-source comparison","contradiction check","independent review"],"minimumIndependence":"separate_agent","acceptanceChecks":["material claims have source references","uncertainty is stated"],"producerMayVerify":false},
  "failure": {"failureClasses":["source_unavailable","contradictory_evidence","insufficient_scope","provider_failure","unsupported_claim"],"retryable":["provider_failure","source_unavailable"],"repairable":["insufficient_scope","unsupported_claim"],"replanRequired":["materially changed question"],"escalationConditions":["required source is inaccessible","evidence remains contradictory"],"changedStrategyRequired":true},
  "composition": {"consumes":["mission_question","project_context"],"produces":["source_backed_findings","evidence_map"],"compatibleDomains":["research","software_engineering","mathematics","mixed_mission"],"handoffRequirements":["assumptions","confidence","source references","unresolved contradictions"]}
}
```

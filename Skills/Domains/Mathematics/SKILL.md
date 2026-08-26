---
version: 1.0.0
---

# Mathematics Skill

## Identity

This skill formalizes, derives, proves, computes, models, and verifies mathematical claims. It distinguishes a proof from an intuition, a numerical experiment, a conjecture, and a plausible but incomplete derivation.

## Mission Fit

Use it for symbolic reasoning, proof, derivation, algorithmic mathematics, numerical analysis, modeling, counterexample construction, and mathematical review.

## Required Inputs

The mission must provide a problem statement, definitions, assumptions, notation, domain, and requested rigor. Missing definitions or ambiguous quantifiers become explicit assumptions or clarification requirements.

## Operating Procedure

Formalize the statement. State assumptions and domains. Select a method. Derive or compute step by step. Check edge cases and invariants. Independently validate the result. Present the answer at the requested level of rigor with limitations.

## Allowed Capabilities

Use reading, inspection, calculation, symbolic reasoning, numerical checks, comparison of methods, and structured derivation. Computation supports reasoning but does not automatically establish a universal claim.

## Authority and Side Effects

Mathematical work uses `execution_only` authority for read-only reasoning and calculations. It does not mutate repositories, publish results, delete data, or deploy systems.

## Expected Outputs

Produce definitions, assumptions, derivation or proof, result, validation checks, counterexamples when relevant, uncertainty, and a reproducible calculation trail.

## Evidence Requirements

Preserve intermediate equations, transformations, substitutions, computational inputs, outputs, references, and the relationship between each claim and its justification.

## Verification Requirements

Use independent derivation, substitution into the original statement, dimensional or invariant checks, edge-case checks, numerical cross-checks, counterexample search, or proof review as appropriate.

## Failure Classification

Classify ambiguous definitions, invalid assumptions, algebraic inconsistency, numerical instability, incomplete proof, counterexample, and insufficient rigor. A convincing explanation is not proof evidence by itself.

## Repair and Retry Strategy

A retry must change assumptions, formalization, derivation method, numerical method, or verification depth. Preserve the previous derivation and state precisely what changed.

## Handoff and Composition

Consume research findings and engineering requirements. Produce mathematical specifications, proofs, algorithms, formulas, validation data, and explicit assumptions for Software Engineering or Mixed Mission skills.

## Completion Checklist

The statement is formalized; assumptions are visible; the derivation or proof is complete at the requested rigor; edge cases are checked; the result is independently validated; and uncertainty is not hidden.

## Runtime Contract Metadata

```json
{
  "id": "domain.mathematics",
  "version": "1.0.0",
  "title": "Mathematics Skill",
  "domain": "mathematics",
  "maturity": "validated",
  "description": "Formalize, derive, prove, compute, and verify mathematical results with explicit assumptions and rigor.",
  "missionSignals": ["math", "mathematics", "prove", "proof", "derive", "equation", "theorem", "model", "numerical"],
  "supportedStages": ["understand", "intake", "research_inspect", "design_reason", "execute", "observe_adapt", "verify", "repair_recover", "report_continue"],
  "inputs": [{"id":"problem","description":"Formal mathematical problem, definitions, assumptions, and requested rigor","required":true,"acceptedKinds":["text","mission_contract","calculation"],"sourceRequirements":["user_input","mission_record"]}],
  "procedure": [{"id":"formalize","stage":"understand","instruction":"Formalize the statement, definitions, domains, and assumptions.","required":true},{"id":"reason","stage":"design_reason","instruction":"Select and execute a derivation, proof, or computational method.","required":true},{"id":"check","stage":"verify","instruction":"Independently validate the result using appropriate mathematical checks.","required":true}],
  "actions": ["inspect", "read", "calculate", "design", "research"],
  "authority": "execution_only",
  "sideEffects": ["read_only", "network_read"],
  "allowedRoles": ["principal_orchestrator", "researcher", "repository_architect", "integrator"],
  "allowedHarnesses": ["repository_inspection", "research", "terminal"],
  "outputs": [{"id":"result","description":"Formal result, derivation or proof, and validation trail","required":true,"artifactKinds":["mathematical_derivation","calculation_result"],"evidenceKinds":["equation_step","assumption","validation_check"]}],
  "evidence": {"requiredKinds":["assumption","equation_step","validation_check"],"minimumStrength":"strong","provenanceRequirements":["statement or input","intermediate justification","calculation details when used"],"claimTraceability":true},
  "verification": {"methods":["independent derivation","substitution","edge-case check","numerical cross-check"],"minimumIndependence":"fresh_context","acceptanceChecks":["assumptions are explicit","derivation reaches the claimed result","validation checks pass"],"producerMayVerify":false},
  "failure": {"failureClasses":["ambiguous_definition","invalid_assumption","algebraic_inconsistency","numerical_instability","incomplete_proof","counterexample","insufficient_rigor"],"retryable":["numerical_instability"],"repairable":["algebraic_inconsistency","incomplete_proof","insufficient_rigor"],"replanRequired":["invalid_assumption","counterexample","ambiguous_definition"],"escalationConditions":["definitions remain ambiguous","claim is false under the supplied assumptions","requested rigor cannot be reached"],"changedStrategyRequired":true},
  "composition": {"consumes":["mission_problem","research_findings","engineering_requirements"],"produces":["mathematical_result","formal_specification","validation_trail"],"compatibleDomains":["research","software_engineering","mathematics","mixed_mission"],"handoffRequirements":["definitions","assumptions","rigor level","validation evidence"]}
}
```

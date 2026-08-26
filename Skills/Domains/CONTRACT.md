---
version: 1.0.0
---

# Nexuss-Agent Domain Skill Contract

A domain skill is a versioned capability profile that gives the workflow runtime domain-specific procedure, capability, evidence, verification, failure, and handoff knowledge. It does not grant authority beyond the active mission, agent role, runner policy, or tool harness.

## Required document structure

Every domain skill must contain the following headings:

`Identity`, `Mission Fit`, `Required Inputs`, `Operating Procedure`, `Allowed Capabilities`, `Authority and Side Effects`, `Expected Outputs`, `Evidence Requirements`, `Verification Requirements`, `Failure Classification`, `Repair and Retry Strategy`, `Handoff and Composition`, `Completion Checklist`, and `Runtime Contract Metadata`.

## Runtime metadata

The `Runtime Contract Metadata` section must contain one fenced `json` block. The JSON object must validate against `DomainSkillContract` in `server/mission/skillSchemas.ts`, excluding runtime-enriched fields `markdown`, `sourceFile`, and `sourceHash`.

The metadata must declare a stable `id`, semantic `version`, domain, supported workflow stages, inputs, procedure steps, actions, authority, side effects, roles, harnesses, outputs, evidence plan, verification plan, failure plan, and composition plan.

## Authority rule

A skill describes what its domain can contribute. It cannot elevate the authority of a role. The runtime intersects skill actions with the active role authority and the runner’s policy before execution.

## Completion rule

A skill is complete only when its required outputs are linked to evidence, its claims are traceable to provenance, its verification method is explicit, and its retry policy requires a materially changed strategy when recovery repeats work.

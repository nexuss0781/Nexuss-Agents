---
version: 1.0.0
---

# Nexuss-Agent Tool and Harness Capability Contract

## Purpose

A capability contract describes the real operations available to the workstation runtime. It is the boundary between a domain skill’s intent and an executable tool or harness. A domain skill may request a capability, but the active role, authority, mission budget, operation allowlist, and harness status still decide whether the operation can run.

## Contract fields

Each capability declares an ID, semantic version, implementation status, operations, action mapping, side-effect class, confirmation requirement, verification requirement, evidence outputs, and secret boundary. Harness contracts additionally declare their maximum timeout and concrete operation list. Tool contracts additionally declare their compatible harnesses and authority class.

## Current implemented harnesses

| Harness | Implemented operations | Side effect |
|---|---|---|
| `mission_intake` | Ingest, normalize, classify, persist intake | Read-only runtime persistence |
| `mission_runtime` | Mission creation, transition, checkpoint, event, lease | Read-only runtime persistence |
| `repository_inspection` | Snapshot, file read, Git status, Git diff, tracked-file listing | Read-only |
| `repository_change` | Bounded file writes | Workspace mutation |
| `repository_verification` | Check, test, build, and diff-check commands | Read-only |
| `filesystem` | Project filesystem inspection, search, mutation, diff, patch, snapshot, manifest, and recovery operations | Read-only or workspace mutation per operation |
| `specialist_spawn` | Registered specialist creation | Read-only orchestration |

The research, browser, WebDev, and terminal harnesses remain explicit contract-only capabilities until their concrete runtime dispatchers are implemented. They are visible in the registry but cannot be invoked as implemented operations.

## Filesystem operation policy

Filesystem operations are represented individually in the capability registry. Inspection, search, diff, preview, snapshot, manifest, export, and verification operations are read-only. Creation, writing, appending, patching, replacement, formatting, copying, moving, renaming, cleanup, deletion, import, rollback, and snapshot restoration are workspace mutations. Destructive operations additionally require confirmation and are still subject to the filesystem runtime’s own policy and audit journal.

## Enforcement sequence

```text
requested domain skill action
  → selected harness and operation
  → capability registry lookup
  → implemented-status check
  → operation allowlist check
  → timeout check
  → active-role authority check
  → confirmation check when required
  → harness-specific policy check
  → execution
  → bounded evidence and artifact record
```

No capability contract widens a role’s authority. A verification role can inspect and verify, but cannot write merely because a software-engineering skill or filesystem contract contains a write operation.

## Evidence rule

Every registered operation must declare evidence. At minimum, runtime evidence contains a bounded summary, operation status, and an artifact or observation reference. Mutating operations also require verification evidence before the work item can be treated as complete.

## Extension rule

A future tool is added by defining its typed contract, registering its operations, declaring side effects and evidence, implementing the dispatcher, adding capability tests, and binding it to the relevant domain skill. Existing workflow stages and role policies must not be bypassed to add a new tool.

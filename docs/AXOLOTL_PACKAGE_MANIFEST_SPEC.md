# Axolotl Store Package Manifest Specification

**Status:** Phase 1 proposal — normative contract for implementation

**Document version:** `1.0.0`

**Package manifest schema version:** `1`

**Owner:** Nexuss-Agent / Axolotl Store

## 1. Purpose

The package manifest is the single, versioned contract used by the Axolotl Store package manager to receive, identify, validate, authorize, install, launch, update, and remove applications.

The package manager owns the manifest contract. An installed application owns its internal feature implementation. The host must never infer permissions or launch behavior from arbitrary application code when the manifest has not declared them.

> **Core rule:** the manifest declares what an application is, where it comes from, how it launches, and what it requests. The package manager decides whether that request is valid and admissible.

## 2. Design Principles

- **Explicit over implicit:** every launch surface, capability, and permission must be declared.
- **Stable identity:** an app ID must remain stable across versions and must never be derived from a display name.
- **Fail closed:** missing, unknown, malformed, or excessive declarations must reject the package rather than receive permissive defaults.
- **Separation of concerns:** the package manager manages packages; the application manages its own domain behavior.
- **First-party exception is explicit:** internal system applications use a declared trusted class and cannot be impersonated by external packages.
- **Reviewable installation:** the package manager must be able to show a human-readable installation and permission summary before activation.
- **Forward compatibility:** additive optional fields may be introduced without invalidating older manifests; semantic changes require a new schema version.
- **No secret material:** tokens, private keys, OAuth secrets, and credentials are never valid manifest fields.

## 3. Versioning Model

The contract has three separate versions:

| Version | Meaning | Example |
| --- | --- | --- |
| `schemaVersion` | Version of the manifest field contract understood by the package manager. | `1` |
| `manifestVersion` | Version of this particular manifest document format. | `1.0.0` |
| `app.version` | Version of the application being installed. | `0.1.0` |

### 3.1 Schema version

`schemaVersion` is an integer. Version `1` is the initial contract. A package manager supporting schema version `N` must accept schema version `N` and any earlier schema versions that have not been retired.

A schema-version increment is required when a field changes meaning, changes type, becomes required, or changes validation semantics in a way that could alter installation behavior.

### 3.2 Manifest version

`manifestVersion` uses semantic versioning. Patch releases correct documentation or validation defects without changing the valid shape. Minor releases add backward-compatible optional fields. Major releases introduce incompatible contract changes.

### 3.3 Application version

`app.version` must use a normalized semantic version such as `0.1.0`, `1.0.0`, or `1.2.3-beta.1`. The package manager compares application versions for update and rollback decisions; it does not infer compatibility from the version alone.

## 4. Package Classes

Every manifest must declare exactly one package class.

| Class | Meaning | Default permissions | Admission path |
| --- | --- | --- | --- |
| `external` | An application supplied by a third-party publisher. | None. All permissions are explicitly requested and reviewed. | External admission policy. |
| `first_party` | An application maintained by the Nexuss organization but not part of the protected host core. | None by default. | First-party admission policy. |
| `system` | A protected Nexuss host application or integration with exceptional privileges. | Only capability-specific grants declared by the host. | Internal system admission policy. |

The package manager must reject unknown package classes. A package cannot declare `system` unless its publisher identity is present in the host-maintained trusted publisher registry.

## 5. Normative Manifest Shape

The following TypeScript-like definition describes the required contract. It is a specification, not the final runtime implementation.

```ts
type PackageManifest = {
  schemaVersion: 1;
  manifestVersion: string;
  kind: "nexuss.application";

  id: string;
  name: string;
  shortName: string;
  description?: string;

  app: {
    version: string;
    icon: IconReference;
    publisher: PublisherIdentity;
    classification: "external" | "first_party" | "system";
  };

  source: SourceReference;
  launch: LaunchDeclaration;
  permissions?: PermissionRequest[];
  capabilities?: CapabilityRequest[];
  compatibility?: CompatibilityDeclaration;
  integrity?: IntegrityDeclaration;
  lifecycle?: LifecycleDeclaration;
};
```

The JSON representation must not contain fields outside the defined contract unless the package manager explicitly supports a namespaced extension mechanism. Unknown top-level fields must be rejected in schema version `1` to prevent typos from silently changing behavior.

## 6. Identity Fields

### 6.1 `schemaVersion`

- **Type:** integer.
- **Required:** yes.
- **Allowed value in Phase 1:** `1`.
- **Validation:** must equal a supported schema version.
- **Failure:** `MANIFEST_SCHEMA_UNSUPPORTED`.

### 6.2 `manifestVersion`

- **Type:** semantic-version string.
- **Required:** yes.
- **Constraints:** maximum 32 characters; no leading or trailing whitespace.
- **Validation:** must parse as semantic version.
- **Failure:** `MANIFEST_VERSION_INVALID`.

### 6.3 `kind`

- **Type:** string literal.
- **Required:** yes.
- **Allowed value:** `nexuss.application`.
- **Failure:** `MANIFEST_KIND_INVALID`.

### 6.4 `id`

The app ID is the immutable package identity used by the registry, launcher, lifecycle manager, and runtime.

- **Type:** string.
- **Required:** yes.
- **Recommended form:** reverse-domain or organization-scoped identifier, for example `nexuss.git`.
- **Allowed characters:** lowercase ASCII letters, digits, hyphens, and dots.
- **Pattern:** `^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$`.
- **Length:** 2–64 characters.
- **Must not:** contain consecutive dots, begin or end with a dot or hyphen, use a reserved host ID, or differ only by case from an existing ID.
- **Immutable:** yes. A renamed application must retain the same ID.
- **Failure:** `APP_ID_INVALID` or `APP_ID_ALREADY_REGISTERED`.

### 6.5 `name`

- **Type:** string.
- **Required:** yes.
- **Length:** 1–80 Unicode characters after trimming.
- **Purpose:** full human-readable application name.
- **Must not:** contain control characters or misleading host branding.
- **Failure:** `APP_NAME_INVALID`.

### 6.6 `shortName`

- **Type:** string.
- **Required:** yes.
- **Length:** 1–24 Unicode characters after trimming.
- **Purpose:** launcher label shown below or beside the app icon.
- **UI behavior:** the launcher may truncate it with an ellipsis or hide it in icon-only mode; the complete value remains available through accessibility text and a tooltip.
- **Failure:** `APP_SHORT_NAME_INVALID`.

### 6.7 `description`

- **Type:** string.
- **Required:** no.
- **Length:** maximum 240 Unicode characters.
- **Purpose:** concise Store and permission-review description.
- **Failure:** `APP_DESCRIPTION_INVALID`.

## 7. Application Metadata

### 7.1 `app.version`

- **Type:** semantic-version string.
- **Required:** yes.
- **Examples:** `0.1.0`, `1.0.0`, `1.4.0-beta.2`.
- **Failure:** `APP_VERSION_INVALID`.

### 7.2 `app.icon`

The icon is required because every approved package becomes an app in the Axolotl Store launcher.

```ts
type IconReference = {
  kind: "asset" | "url" | "data";
  value: string;
  light?: string;
  dark?: string;
  alt?: string;
};
```

Rules:

- `kind` is required and must be one of the allowed values.
- `value` is required and must identify the primary icon.
- `alt` is required for accessibility and must be 1–120 characters.
- `url` icons must use HTTPS and must pass host allowlisting rules.
- `data` icons must use an allowed image MIME type and a strict byte limit.
- `asset` icons must resolve inside the installed package boundary.
- Executable content is never accepted as an icon.
- The package manager must create a safe fallback only for rendering failures after the manifest itself has passed validation; a missing icon is a manifest rejection.

**Failure codes:** `ICON_MISSING`, `ICON_REFERENCE_INVALID`, `ICON_HOST_NOT_ALLOWED`, `ICON_SIZE_EXCEEDED`, `ICON_TYPE_UNSUPPORTED`.

### 7.3 `app.publisher`

```ts
type PublisherIdentity = {
  id: string;
  name: string;
  website?: string;
};
```

Rules:

- `id` is required, lowercase, and 2–64 characters.
- `name` is required and 1–80 characters.
- `website`, when present, must use HTTPS.
- The publisher ID must match the identity associated with the submitted source and authorization context.
- System packages must match a trusted publisher registry entry.

**Failure codes:** `PUBLISHER_INVALID`, `PUBLISHER_SOURCE_MISMATCH`, `SYSTEM_PUBLISHER_UNTRUSTED`.

### 7.4 `app.classification`

- **Type:** enum.
- **Required:** yes.
- **Allowed values:** `external`, `first_party`, `system`.
- **Validation:** the package manager compares the declared value with the publisher registry and submission channel.
- **Failure:** `CLASSIFICATION_INVALID` or `CLASSIFICATION_NOT_AUTHORIZED`.

## 8. Source Contract

```ts
type SourceReference = {
  type: "github";
  repository: string;
  ref?: string;
  subdirectory?: string;
};
```

### 8.1 `source.type`

- **Required:** yes.
- **Phase 1 allowed value:** `github`.
- **Failure:** `SOURCE_TYPE_UNSUPPORTED`.

### 8.2 `source.repository`

- **Type:** HTTPS URL.
- **Required:** yes.
- **Allowed host:** GitHub host policy, initially `github.com` and approved enterprise GitHub hosts if configured.
- **Expected form:** `https://github.com/{owner}/{repository}`.
- **Must not:** contain embedded credentials, query-string secrets, fragments, or an arbitrary download endpoint.
- **Normalization:** remove a trailing slash and normalize `.git` suffix for identity comparison.
- **Validation:** repository must be resolvable and its publisher ownership must be consistent with the manifest.
- **Failure codes:** `SOURCE_REPOSITORY_INVALID`, `SOURCE_HOST_NOT_ALLOWED`, `SOURCE_REPOSITORY_UNRESOLVED`, `SOURCE_PUBLISHER_MISMATCH`.

### 8.3 `source.ref`

- **Type:** string.
- **Required:** no.
- **Meaning:** immutable tag or commit reference used for reproducible installation.
- **Recommendation:** release packages should provide a tag or commit SHA rather than relying on a moving branch.
- **Failure:** `SOURCE_REF_INVALID`.

### 8.4 `source.subdirectory`

- **Type:** relative POSIX path.
- **Required:** no.
- **Constraints:** must remain inside the repository; must not contain `..`, an absolute prefix, or a null byte.
- **Purpose:** supports a package stored in a monorepo subdirectory.
- **Failure:** `SOURCE_SUBDIRECTORY_INVALID`.

## 9. Launch Contract

```ts
type LaunchDeclaration = {
  surface: "right-window";
  entrypoint: string;
  defaultWidth?: number;
  minWidth?: number;
  resizable?: boolean;
  supportsExpanded?: boolean;
};
```

### 9.1 `launch.surface`

- **Required:** yes.
- **Phase 1 allowed value:** `right-window`.
- **Meaning:** the application opens inside the host’s right-window surface.
- **Failure:** `LAUNCH_SURFACE_UNSUPPORTED`.

### 9.2 `launch.entrypoint`

- **Type:** package-relative identifier.
- **Required:** yes.
- **Length:** 1–120 characters.
- **Allowed characters:** letters, digits, hyphens, underscores, dots, and slashes.
- **Must not:** be an absolute path, contain `..`, or escape the package boundary.
- **Purpose:** identifies the registered application entrypoint, not an arbitrary shell command.
- **Failure:** `LAUNCH_ENTRYPOINT_INVALID` or `LAUNCH_ENTRYPOINT_NOT_FOUND`.

### 9.3 `launch.defaultWidth`

- **Type:** integer pixels.
- **Required:** no.
- **Default:** host-defined default, currently 380px.
- **Allowed range:** 320–960px, subject to the host’s available workspace width.
- **Failure:** `LAUNCH_DEFAULT_WIDTH_INVALID`.

### 9.4 `launch.minWidth`

- **Type:** integer pixels.
- **Required:** no.
- **Default:** host minimum, currently 320px.
- **Allowed range:** 320–960px.
- **Constraint:** must not exceed `defaultWidth` when both are present; the host may clamp both values to the available viewport.
- **Failure:** `LAUNCH_MIN_WIDTH_INVALID`.

### 9.5 `launch.resizable`

- **Type:** boolean.
- **Required:** no.
- **Default:** `true`.
- **Meaning:** permits the user to resize the right window within host safety bounds.
- **Note:** `false` does not allow the application to control host layout; it only disables user resizing for that app.

### 9.6 `launch.supportsExpanded`

- **Type:** boolean.
- **Required:** no.
- **Default:** `true`.
- **Meaning:** declares whether the app can render correctly when the right window expands across the workspace up to the left thread sidebar.

## 10. Permissions

Permissions describe access to protected host or external resources. They are requested by the package and granted by admission policy; declaration does not guarantee approval.

```ts
type PermissionRequest =
  | "repository.read"
  | "repository.write"
  | "github.repositories.read"
  | "github.commits.read"
  | "github.branches.write"
  | "github.pull_requests.read"
  | "github.pull_requests.write"
  | "github.issues.read"
  | "github.issues.write"
  | "github.actions.read"
  | "github.actions.write"
  | "github.releases.write"
  | "project.context.read"
  | "window.control";
```

Rules:

- Permissions must be declared as a unique array.
- Unknown permissions reject the manifest.
- The package manager must show requested permissions before installation.
- The host must issue an effective permission set that may be narrower than requested.
- A package must not receive write access merely because it requests read access.
- Credentials are never exposed directly to the extension; the host mediates authorized operations.
- `window.control` permits only the documented right-window API, not arbitrary host DOM access.

## 11. Capabilities

Capabilities describe host features the application can use. They are distinct from permissions because a capability may expose a controlled host function while a permission authorizes access to data or an external operation.

```ts
type CapabilityRequest =
  | "window.resize"
  | "window.expand"
  | "project.context"
  | "extension.storage"
  | "activity.report"
  | "repository.workspace"
  | "agent.request";
```

Rules:

- Capabilities must be unique.
- Unknown capabilities reject the manifest in schema version `1`.
- `window.resize` requires `window.control`.
- `window.expand` requires `window.control` and `launch.supportsExpanded: true`.
- `repository.workspace` requires at least `repository.read`.
- `agent.request` requires a separate host policy and must be disabled for untrusted packages until that policy exists.

## 12. Compatibility Declaration

```ts
type CompatibilityDeclaration = {
  host: {
    minVersion?: string;
    maxVersion?: string;
  };
  api: {
    minVersion: number;
    maxVersion?: number;
  };
  runtimes?: string[];
};
```

Rules:

- `host.minVersion` and `host.maxVersion`, when present, must be semantic versions.
- `api.minVersion` is required when the compatibility object exists.
- `api.minVersion` must be less than or equal to `api.maxVersion`.
- The host rejects packages whose required API range does not include a supported runtime API version.
- If compatibility is omitted, the package must use only the stable Phase 1 API surface; experimental APIs cannot be assumed.

## 13. Integrity Declaration

```ts
type IntegrityDeclaration = {
  sourceCommit?: string;
  manifestDigest?: string;
  packageDigest?: string;
};
```

Rules:

- `sourceCommit`, when supplied, must be a valid full commit identifier accepted by the configured source provider.
- Digests must declare an algorithm prefix such as `sha256-`.
- The package manager computes and stores its own verified digest regardless of whether the optional integrity object is supplied.
- A mismatch between declared and calculated integrity rejects installation.

## 14. Lifecycle Declaration

```ts
type LifecycleDeclaration = {
  updatePolicy?: "manual" | "compatible" | "automatic";
  uninstallPolicy?: "retain-data" | "remove-data";
};
```

Rules:

- `updatePolicy` defaults to `manual`.
- External applications cannot request automatic updates during Phase 1.
- `uninstallPolicy` defaults to `retain-data`.
- Package data must be stored in an app-scoped namespace so retention does not expose data to another app ID.

## 15. Canonical Nexuss-Git Manifest Example

```json
{
  "schemaVersion": 1,
  "manifestVersion": "1.0.0",
  "kind": "nexuss.application",
  "id": "nexuss.git",
  "name": "Nexuss-Git",
  "shortName": "GitHub",
  "description": "A guided Git and GitHub workspace for repository work.",
  "app": {
    "version": "0.1.0",
    "icon": {
      "kind": "asset",
      "value": "assets/icon.svg",
      "alt": "Nexuss-Git"
    },
    "publisher": {
      "id": "nexuss0781",
      "name": "Nexuss"
    },
    "classification": "first_party"
  },
  "source": {
    "type": "github",
    "repository": "https://github.com/nexuss0781/Nexuss-Git",
    "ref": "v0.1.0"
  },
  "launch": {
    "surface": "right-window",
    "entrypoint": "nexuss-git",
    "defaultWidth": 520,
    "minWidth": 360,
    "resizable": true,
    "supportsExpanded": true
  },
  "permissions": [
    "repository.read",
    "repository.write",
    "github.repositories.read",
    "github.commits.read",
    "github.branches.write",
    "github.pull_requests.read",
    "github.pull_requests.write",
    "github.issues.read",
    "github.issues.write",
    "github.actions.read",
    "project.context.read"
  ],
  "capabilities": [
    "window.resize",
    "window.expand",
    "project.context",
    "extension.storage",
    "activity.report",
    "repository.workspace"
  ],
  "compatibility": {
    "api": {
      "minVersion": 1,
      "maxVersion": 1
    }
  },
  "integrity": {
    "sourceCommit": "<resolved-release-commit>"
  },
  "lifecycle": {
    "updatePolicy": "manual",
    "uninstallPolicy": "retain-data"
  }
}
```

The placeholder commit in this example must be replaced by an actual resolved release commit during package submission. A package must not claim a mutable branch as a reproducible release reference without an additional integrity record.

## 16. Validation Pipeline

Validation is ordered and fail-closed. The package manager should return all independent errors from the same stage when practical, but must not continue to installation after a blocking failure.

### Stage 1 — Transport and parsing

- Confirm a manifest object was received.
- Parse UTF-8 JSON.
- Reject duplicate JSON keys if the parser supports detection.
- Reject invalid JSON, oversized documents, and non-object roots.

**Failure codes:** `MANIFEST_MISSING`, `MANIFEST_PARSE_FAILED`, `MANIFEST_TOO_LARGE`, `MANIFEST_ROOT_INVALID`.

### Stage 2 — Schema structure

- Validate required top-level fields.
- Validate field types.
- Reject unknown top-level fields.
- Validate enum values.
- Validate nested object structure.

**Failure codes:** `MANIFEST_FIELD_MISSING`, `MANIFEST_FIELD_TYPE_INVALID`, `MANIFEST_UNKNOWN_FIELD`, `MANIFEST_ENUM_INVALID`.

### Stage 3 — Identity and normalization

- Trim permitted human-readable fields.
- Normalize app ID and repository URL.
- Validate app ID uniqueness.
- Validate name and short name.
- Validate semantic versions.

**Failure codes:** `APP_ID_INVALID`, `APP_ID_ALREADY_REGISTERED`, `APP_NAME_INVALID`, `APP_SHORT_NAME_INVALID`, `APP_VERSION_INVALID`.

### Stage 4 — Source verification

- Validate the GitHub source URL.
- Resolve the repository.
- Verify the declared publisher association.
- Resolve the requested ref or release.
- Verify subdirectory boundaries.

**Failure codes:** `SOURCE_REPOSITORY_INVALID`, `SOURCE_REPOSITORY_UNRESOLVED`, `SOURCE_REF_INVALID`, `SOURCE_PUBLISHER_MISMATCH`, `SOURCE_SUBDIRECTORY_INVALID`.

### Stage 5 — Asset and launch verification

- Verify the icon reference.
- Verify the entrypoint is inside the package boundary.
- Verify declared widths and launch surface.
- Verify the entrypoint can be loaded by the supported runtime.

**Failure codes:** `ICON_REFERENCE_INVALID`, `ICON_SIZE_EXCEEDED`, `LAUNCH_ENTRYPOINT_INVALID`, `LAUNCH_ENTRYPOINT_NOT_FOUND`, `LAUNCH_SURFACE_UNSUPPORTED`.

### Stage 6 — Classification and admission

- Compare package class with publisher trust.
- Apply external, first-party, or system admission rules.
- Reject unauthorized system declarations.
- Reject unsupported or excessive permission requests.

**Failure codes:** `CLASSIFICATION_NOT_AUTHORIZED`, `SYSTEM_PUBLISHER_UNTRUSTED`, `PERMISSION_UNKNOWN`, `PERMISSION_NOT_ALLOWED`, `CAPABILITY_NOT_ALLOWED`.

### Stage 7 — Compatibility and integrity

- Check host version compatibility.
- Check extension API compatibility.
- Verify source commit and calculated digest.
- Produce the normalized manifest and effective permission set.

**Failure codes:** `HOST_VERSION_UNSUPPORTED`, `API_VERSION_UNSUPPORTED`, `INTEGRITY_MISMATCH`, `INTEGRITY_UNAVAILABLE`.

## 17. Normalized Manifest Output

The package manager should not store the raw request as its only record. After validation it should produce a normalized manifest containing:

- Canonical app ID.
- Trimmed display metadata.
- Canonical repository URL.
- Resolved source ref and commit.
- Verified icon reference.
- Declared permissions.
- Granted permissions.
- Declared capabilities.
- Granted capabilities.
- Package classification.
- Host and API compatibility result.
- Computed package digest.
- Validation timestamp.
- Validator version.

The normalized manifest becomes the input to installation and the durable package registry.

## 18. Compatibility Policy

### Accepted without migration

- Older supported `schemaVersion` values.
- New optional fields unknown to a newer producer only when they are placed inside an explicitly namespaced extension object in a future schema.
- Patch-level manifest changes that do not alter field meaning.

### Requires migration

- A new required field.
- A field changing type or semantic meaning.
- A permission or capability changing from advisory to enforced.
- A launch contract change.
- A change to package-class authorization.

### Rejected

- Unknown schema versions.
- Unknown top-level fields in schema version `1`.
- Missing required fields.
- Invalid or untrusted source references.
- Unrecognized permissions or capabilities.
- System classification without trusted publisher authorization.
- Packages that attempt to embed secrets or arbitrary executable launch commands.

## 19. Package Manager Error Shape

All validation failures should use one stable error shape:

```ts
type PackageValidationError = {
  code: string;
  path: string;
  message: string;
  severity: "error" | "warning";
  retryable: boolean;
};
```

Example:

```json
{
  "code": "LAUNCH_MIN_WIDTH_INVALID",
  "path": "launch.minWidth",
  "message": "Minimum width must be between 320 and 960 pixels and cannot exceed the default width.",
  "severity": "error",
  "retryable": false
}
```

The UI may present a shorter message, but the durable package-validation record must retain the code and field path for debugging and auditability.

## 20. Phase 1 Acceptance Criteria

Phase 1 is complete when:

- A version `1` manifest schema is represented in code and documentation.
- The package manager can parse and normalize a valid manifest.
- Invalid fields produce stable error codes and field paths.
- Duplicate app IDs are rejected before installation.
- External, first-party, and system classifications are distinguished.
- GitHub source ownership and source reference checks are defined.
- Every app declares an icon, full name, short name, source, and right-window launch entrypoint.
- Permissions and capabilities are separate, enumerable, and fail-closed.
- The package manager can calculate an effective permission set.
- Host and API compatibility rules are explicit.
- The Nexuss-Git example can be submitted as a first-party right-window application without special-case fields.
- The contract is versioned so future applications do not require changing the host for every new app.

## 21. Implementation Boundary for the Next Phase

Phase 1 defines the contract only. It does not yet implement the validator, registry, installer, or Nexuss-Git features.

The next component is **Package Identity and Metadata Validator**. Its responsibility is to turn this specification into deterministic runtime validation for app IDs, names, icons, versions, publisher metadata, and normalized manifest output.


## 22. Phase 2 Runtime Validator

The Phase 2 implementation is available at `server/packageManager/manifest.ts` and exposes `validatePackageManifest(input, options)`. It is dependency-free and suitable for server-side package admission, registry writes, and unit testing.

```ts
const result = validatePackageManifest(candidateManifest, {
  existingAppIds: registeredIds,
  trustedSystemPublishers: ["nexuss"],
  trustedFirstPartyPublishers: ["nexuss0781"],
});

if (!result.ok) {
  for (const error of result.errors) {
    console.error(error.code, error.path, error.message);
  }
} else {
  install(result.manifest);
}
```

A successful result contains a normalized manifest with canonical GitHub repository URL, default launch values, unique permission and capability arrays, and a normalized launch record. A failed result never contains an installable manifest. Warnings, such as a moving branch reference, do not block validation but remain available for admission policy and user review.

The validator deliberately does not perform network access, clone repositories, install packages, or grant permissions. Those responsibilities belong to later package-manager components. Source syntax, host allowlisting, publisher declarations, and manifest integrity declarations are validated here; source reachability and publisher ownership must be verified by the later admission and installation layers.

Phase 2 tests are located at `server/packageManager/manifest.test.ts` and cover valid normalization, strict unknown-field rejection, duplicate IDs, source validation, launch constraints, icon constraints, capability relationships, trusted system publishers, API compatibility, and reproducibility warnings.


## 23. Phase 3 Secure Downloader and Verifier

The Phase 3 implementation is available at `server/packageManager/downloader.ts` and exposes `downloadAndVerifyPackage(manifestInput, options)`. It is intentionally server-side and dependency-light. It does not execute package code, run package lifecycle scripts, or grant permissions.

The downloader follows this sequence:

1. Validate and normalize the manifest with the Phase 2 validator.
2. Require a reproducible source tag or full commit unless an explicit development-only moving-ref override is supplied.
3. Verify a declared source commit when the caller resolves one.
4. Compute and compare the normalized manifest digest when one is declared.
5. Download the GitHub archive over HTTPS with redirects disabled.
6. Enforce response and streaming byte limits.
7. Inspect archive paths before extraction.
8. Reject unsafe links and special files.
9. Extract into a random, private transaction directory with ownership and permission metadata ignored.
10. Re-scan the extracted tree for path escapes, links, special files, file-count limits, and total-size limits.
11. Resolve and verify the declared package subdirectory.
12. Return the verified staging path and SHA-256 archive and manifest digests.

```ts
const result = await downloadAndVerifyPackage(manifest, {
  stagingDirectory: "/var/lib/nexuss-packages",
  maxDownloadBytes: 50 * 1024 * 1024,
  maxExtractedBytes: 250 * 1024 * 1024,
  maxFiles: 20_000,
  timeoutMs: 30_000,
});

if (!result.ok) {
  // Persist result.errors in the package admission record.
  return result;
}

// Pass result.packageRoot to the later installer; do not execute it here.
return result;
```

A failed transaction is removed automatically. A successful transaction remains in its private staging directory for the later installer to atomically promote into the package registry. The helper `removePackageStaging` refuses to remove the staging root itself or any path outside the configured root.

The downloader does not claim that a GitHub tag resolves to a particular commit by itself. The admission layer must resolve the ref through the configured GitHub integration and pass `resolvedSourceCommit` when the manifest declares an integrity source commit. This keeps network resolution and package acquisition separate from deterministic archive and filesystem verification.

The Phase 3 tests are located at `server/packageManager/downloader.test.ts`. They cover successful bounded extraction, reproducible-ref enforcement, source-commit verification, download-size limits, manifest digest mismatch, archive traversal rejection, and failed-transaction cleanup.


## 24. Phase 4 External-App Execution Sandbox

The Phase 4 implementation is available at `server/packageManager/sandbox.ts`. External apps do not receive direct access to Node.js, the host filesystem, arbitrary environment variables, arbitrary child processes, or GitHub credentials. They receive a capability-scoped broker created with `createExternalAppSandbox()`.

Host grants are **fail-closed**. If `grantedPermissions` or `grantedCapabilities` is omitted, the sandbox grants nothing, even when the manifest declares permissions or capabilities. The package manager must calculate the user- and policy-approved grant explicitly and pass only the approved subset. Any requested grant not declared by the manifest is discarded.

```ts
const sandbox = createExternalAppSandbox({
  manifest: normalizedManifest,
  packageRoot: verifiedPackageRoot,
  workspaceRoot: projectWorkspaceRoot,
  grantedPermissions: ["repository.read"],
  grantedCapabilities: ["repository.workspace", "extension.storage", "activity.report"],
  limits: {
    maxOperationMs: 10_000,
    maxFileBytes: 5 * 1024 * 1024,
    maxDirectoryEntries: 2_000,
  },
  audit: (event) => auditStore.append(event),
});
```

The broker exposes only scoped operations:

- `readPackageFile` and `listPackageDirectory` are confined to the verified package root and require `extension.storage`.
- `readWorkspaceFile` and `listWorkspaceDirectory` are confined to the configured project workspace and require `repository.read` plus `repository.workspace`.
- `writeWorkspaceFile` requires `repository.write`, `repository.read`, and `repository.workspace`.
- `getProjectContext` requires `project.context.read` and an explicitly supplied host context provider.
- `reportActivity` requires `activity.report` and limits event detail size.
- `runTask` provides cancellation, a maximum operation duration, and lifecycle audit events. It is not an arbitrary shell or code execution API.

Every filesystem path is relative, normalized, resolved under its permitted root, and checked through realpath resolution to prevent traversal and symlink escapes. Regular-file size, directory-entry count, and operation duration are bounded. Non-regular files are rejected.

A sandbox operation emits `started` and then `completed`, `failed`, `cancelled`, or `denied`. Permission and capability denials are recorded before the error is raised. The broker never silently broadens a grant, and the host can revoke access by cancelling the parent signal or disposing the sandbox owner.

This layer is an application-level isolation boundary for the host API. It must not be described as a kernel or container security boundary. If future packages need to execute arbitrary untrusted server code, that execution must be moved to a separately isolated worker or container runtime with an independent filesystem, network policy, identity, and operating-system limits. The Phase 4 broker intentionally does not provide arbitrary code execution.

The Phase 4 tests are located at `server/packageManager/sandbox.test.ts`. They cover fail-closed grants, scoped reads and writes, path traversal rejection, package/workspace separation, permission denial audit events, timeout cancellation, resource-limit validation, and rejection of non-external packages.

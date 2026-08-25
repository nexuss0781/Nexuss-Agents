export const SUPPORTED_SCHEMA_VERSION = 1 as const;
export const SUPPORTED_MANIFEST_API_VERSION = 1 as const;

export type PackageClass = "external" | "first_party" | "system";
export type LaunchSurface = "right-window";
export type IconKind = "asset" | "url" | "data";
export type Permission =
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
export type Capability =
  | "window.resize"
  | "window.expand"
  | "project.context"
  | "extension.storage"
  | "activity.report"
  | "repository.workspace"
  | "agent.request";

export type IconReference = {
  kind: IconKind;
  value: string;
  light?: string;
  dark?: string;
  alt: string;
};
export type PublisherIdentity = { id: string; name: string; website?: string };
export type SourceReference = { type: "github"; repository: string; ref?: string; subdirectory?: string };
export type LaunchDeclaration = {
  surface: LaunchSurface;
  entrypoint: string;
  defaultWidth?: number;
  minWidth?: number;
  resizable?: boolean;
  supportsExpanded?: boolean;
};
export type CompatibilityDeclaration = {
  host?: { minVersion?: string; maxVersion?: string };
  api: { minVersion: number; maxVersion?: number };
  runtimes?: string[];
};
export type IntegrityDeclaration = { sourceCommit?: string; manifestDigest?: string; packageDigest?: string };
export type LifecycleDeclaration = { updatePolicy?: "manual" | "compatible" | "automatic"; uninstallPolicy?: "retain-data" | "remove-data" };

export type PackageManifest = {
  schemaVersion: typeof SUPPORTED_SCHEMA_VERSION;
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
    classification: PackageClass;
  };
  source: SourceReference;
  launch: LaunchDeclaration;
  permissions?: Permission[];
  capabilities?: Capability[];
  compatibility?: CompatibilityDeclaration;
  integrity?: IntegrityDeclaration;
  lifecycle?: LifecycleDeclaration;
};

export type PackageValidationError = {
  code: string;
  path: string;
  message: string;
  severity: "error" | "warning";
  retryable: boolean;
};
export type NormalizedPackageManifest = PackageManifest & {
  normalized: {
    repository: string;
    sourceRef?: string;
    permissions: Permission[];
    capabilities: Capability[];
    launch: Required<Pick<LaunchDeclaration, "defaultWidth" | "minWidth" | "resizable" | "supportsExpanded">> & Pick<LaunchDeclaration, "surface" | "entrypoint">;
  };
};
export type ManifestValidationOptions = {
  existingAppIds?: Iterable<string>;
  trustedSystemPublishers?: Iterable<string>;
  trustedFirstPartyPublishers?: Iterable<string>;
  allowedGithubHosts?: Iterable<string>;
  maxDocumentBytes?: number;
};
export type ManifestValidationResult =
  | { ok: true; manifest: NormalizedPackageManifest; warnings: PackageValidationError[] }
  | { ok: false; errors: PackageValidationError[]; warnings: PackageValidationError[] };

const permissions = new Set<Permission>([
  "repository.read", "repository.write", "github.repositories.read", "github.commits.read", "github.branches.write",
  "github.pull_requests.read", "github.pull_requests.write", "github.issues.read", "github.issues.write",
  "github.actions.read", "github.actions.write", "github.releases.write", "project.context.read", "window.control",
]);
const capabilities = new Set<Capability>([
  "window.resize", "window.expand", "project.context", "extension.storage", "activity.report", "repository.workspace", "agent.request",
]);
const topLevelKeys = new Set(["schemaVersion", "manifestVersion", "kind", "id", "name", "shortName", "description", "app", "source", "launch", "permissions", "capabilities", "compatibility", "integrity", "lifecycle"]);
const forbiddenKeys = /token|secret|password|privatekey|clientsecret|apikey/i;
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const appIdPattern = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/;
const fullCommitPattern = /^[0-9a-f]{40}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringValue(value: unknown): value is string { return typeof value === "string"; }
function integerValue(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value); }
function addError(errors: PackageValidationError[], code: string, path: string, message: string, retryable = false) {
  errors.push({ code, path, message, severity: "error", retryable });
}
function addWarning(warnings: PackageValidationError[], code: string, path: string, message: string) {
  warnings.push({ code, path, message, severity: "warning", retryable: false });
}
function requiredString(value: unknown, path: string, errors: PackageValidationError[], code: string, min: number, max: number) {
  if (!stringValue(value) || value.trim().length < min || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    addError(errors, code, path, `Expected a trimmed string between ${min} and ${max} characters.`);
    return undefined;
  }
  return value.trim();
}
function checkUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, path: string, errors: PackageValidationError[]) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) addError(errors, "MANIFEST_UNKNOWN_FIELD", path ? `${path}.${key}` : key, "Field is not supported by schema version 1.");
}
function walkForbiddenKeys(value: unknown, path: string, errors: PackageValidationError[]) {
  if (Array.isArray(value)) { value.forEach((item, index) => walkForbiddenKeys(item, `${path}[${index}]`, errors)); return; }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.test(key)) addError(errors, "MANIFEST_SECRET_FORBIDDEN", path ? `${path}.${key}` : key, "Secrets and credential material are not valid package manifest fields.");
    walkForbiddenKeys(child, path ? `${path}.${key}` : key, errors);
  }
}
function isHttpsUrl(value: string) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}
function normalizeGithubRepository(value: string, allowedHosts: Set<string>, errors: PackageValidationError[]) {
  let url: URL;
  try { url = new URL(value); } catch { addError(errors, "SOURCE_REPOSITORY_INVALID", "source.repository", "Repository must be a valid HTTPS GitHub URL."); return undefined; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !allowedHosts.has(host) || url.username || url.password || url.search || url.hash) {
    addError(errors, url.protocol !== "https:" ? "SOURCE_REPOSITORY_INVALID" : "SOURCE_HOST_NOT_ALLOWED", "source.repository", "Repository must be an HTTPS URL on an allowed GitHub host.");
    return undefined;
  }
  const parts = url.pathname.replace(/\.git$/, "").replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))) {
    addError(errors, "SOURCE_REPOSITORY_INVALID", "source.repository", "Repository must use the form https://github.com/owner/repository.");
    return undefined;
  }
  return `https://${host}/${parts[0]}/${parts[1]}`;
}
function validateUniqueEnumArray<T extends string>(value: unknown, path: string, allowed: Set<T>, errors: PackageValidationError[], unknownCode: string): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) { addError(errors, "MANIFEST_FIELD_TYPE_INVALID", path, "Expected an array."); return []; }
  const result: T[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!stringValue(item) || !allowed.has(item as T)) addError(errors, unknownCode, `${path}[${index}]`, "Value is not supported by the package contract.");
    else if (result.includes(item as T)) addError(errors, "MANIFEST_DUPLICATE_VALUE", `${path}[${index}]`, "Array values must be unique.");
    else result.push(item as T);
  }
  return result;
}
function validateSemver(value: unknown, path: string, errors: PackageValidationError[], code: string) {
  if (!stringValue(value) || !semverPattern.test(value.trim())) addError(errors, code, path, "Expected a semantic version such as 1.0.0.");
  return stringValue(value) ? value.trim() : "";
}

export function validatePackageManifest(input: unknown, options: ManifestValidationOptions = {}): ManifestValidationResult {
  const errors: PackageValidationError[] = [];
  const warnings: PackageValidationError[] = [];
  if (!isRecord(input)) {
    addError(errors, "MANIFEST_ROOT_INVALID", "", "Manifest root must be a JSON object.");
    return { ok: false, errors, warnings };
  }
  const maxBytes = options.maxDocumentBytes ?? 64 * 1024;
  try { if (Buffer.byteLength(JSON.stringify(input), "utf8") > maxBytes) addError(errors, "MANIFEST_TOO_LARGE", "", `Manifest exceeds the ${maxBytes}-byte limit.`); } catch { addError(errors, "MANIFEST_SERIALIZATION_FAILED", "", "Manifest could not be serialized for validation."); }
  checkUnknownKeys(input, topLevelKeys, "", errors);
  walkForbiddenKeys(input, "", errors);

  if (input.schemaVersion !== SUPPORTED_SCHEMA_VERSION) addError(errors, "MANIFEST_SCHEMA_UNSUPPORTED", "schemaVersion", "Only schema version 1 is supported.");
  const manifestVersion = validateSemver(input.manifestVersion, "manifestVersion", errors, "MANIFEST_VERSION_INVALID");
  if (input.kind !== "nexuss.application") addError(errors, "MANIFEST_KIND_INVALID", "kind", "Kind must be nexuss.application.");
  const id = requiredString(input.id, "id", errors, "APP_ID_INVALID", 2, 64);
  if (id && (!appIdPattern.test(id) || id.includes("..") || id.includes(".-") || id.includes("-."))) addError(errors, "APP_ID_INVALID", "id", "App ID must use lowercase letters, digits, hyphens, and dots without invalid separators.");
  if (id && new Set(options.existingAppIds ?? []).has(id)) addError(errors, "APP_ID_ALREADY_REGISTERED", "id", "App ID is already registered.");
  const name = requiredString(input.name, "name", errors, "APP_NAME_INVALID", 1, 80);
  const shortName = requiredString(input.shortName, "shortName", errors, "APP_SHORT_NAME_INVALID", 1, 24);
  const description = input.description === undefined ? undefined : requiredString(input.description, "description", errors, "APP_DESCRIPTION_INVALID", 1, 240);

  const app = isRecord(input.app) ? input.app : undefined;
  if (!app) addError(errors, "MANIFEST_FIELD_MISSING", "app", "App metadata object is required.");
  else checkUnknownKeys(app, new Set(["version", "icon", "publisher", "classification"]), "app", errors);
  const appVersion = validateSemver(app?.version, "app.version", errors, "APP_VERSION_INVALID");
  const classification = app?.classification;
  if (classification !== "external" && classification !== "first_party" && classification !== "system") addError(errors, "CLASSIFICATION_INVALID", "app.classification", "Classification must be external, first_party, or system.");

  const publisherValue = app?.publisher;
  const publisher = isRecord(publisherValue) ? publisherValue : undefined;
  if (!publisher) addError(errors, "PUBLISHER_INVALID", "app.publisher", "Publisher metadata object is required.");
  else checkUnknownKeys(publisher, new Set(["id", "name", "website"]), "app.publisher", errors);
  const publisherId = requiredString(publisher?.id, "app.publisher.id", errors, "PUBLISHER_INVALID", 2, 64);
  const publisherName = requiredString(publisher?.name, "app.publisher.name", errors, "PUBLISHER_INVALID", 1, 80);
  const publisherWebsite = publisher?.website === undefined ? undefined : requiredString(publisher.website, "app.publisher.website", errors, "PUBLISHER_INVALID", 1, 300);
  if (publisherWebsite && !isHttpsUrl(publisherWebsite)) addError(errors, "PUBLISHER_INVALID", "app.publisher.website", "Publisher website must use HTTPS.");
  if (classification === "system" && publisherId && !new Set(options.trustedSystemPublishers ?? []).has(publisherId)) addError(errors, "SYSTEM_PUBLISHER_UNTRUSTED", "app.publisher.id", "System packages require a trusted publisher identity.");
  if (classification === "first_party" && options.trustedFirstPartyPublishers && publisherId && !new Set(options.trustedFirstPartyPublishers).has(publisherId)) addError(errors, "CLASSIFICATION_NOT_AUTHORIZED", "app.publisher.id", "First-party packages require an authorized publisher identity.");

  const iconValue = app?.icon;
  const icon = isRecord(iconValue) ? iconValue : undefined;
  if (!icon) addError(errors, "ICON_MISSING", "app.icon", "An app icon is required.");
  else checkUnknownKeys(icon, new Set(["kind", "value", "light", "dark", "alt"]), "app.icon", errors);
  const iconKind = icon?.kind;
  if (iconKind !== "asset" && iconKind !== "url" && iconKind !== "data") addError(errors, "ICON_REFERENCE_INVALID", "app.icon.kind", "Icon kind must be asset, url, or data.");
  const iconReference = requiredString(icon?.value, "app.icon.value", errors, "ICON_REFERENCE_INVALID", 1, 2048);
  const iconAlt = requiredString(icon?.alt, "app.icon.alt", errors, "ICON_REFERENCE_INVALID", 1, 120);
  if (iconKind === "url" && iconReference && !isHttpsUrl(iconReference)) addError(errors, "ICON_HOST_NOT_ALLOWED", "app.icon.value", "URL icons must use HTTPS.");
  if (iconKind === "asset" && iconReference && (iconReference.startsWith("/") || iconReference.split("/").includes(".."))) addError(errors, "ICON_REFERENCE_INVALID", "app.icon.value", "Asset icons must remain inside the package boundary.");
  if (iconKind === "data" && iconReference && !/^data:image\/(svg\+xml|png|webp);base64,/i.test(iconReference)) addError(errors, "ICON_TYPE_UNSUPPORTED", "app.icon.value", "Data icons must be base64 encoded SVG, PNG, or WebP images.");

  const sourceValue = isRecord(input.source) ? input.source : undefined;
  if (!sourceValue) addError(errors, "MANIFEST_FIELD_MISSING", "source", "Source declaration is required.");
  else checkUnknownKeys(sourceValue, new Set(["type", "repository", "ref", "subdirectory"]), "source", errors);
  if (sourceValue?.type !== "github") addError(errors, "SOURCE_TYPE_UNSUPPORTED", "source.type", "Only GitHub sources are supported in schema version 1.");
  const allowedHosts = new Set(options.allowedGithubHosts ?? ["github.com"]);
  const repository = stringValue(sourceValue?.repository) ? normalizeGithubRepository(sourceValue.repository, allowedHosts, errors) : undefined;
  if (!repository && sourceValue?.repository === undefined) addError(errors, "SOURCE_REPOSITORY_INVALID", "source.repository", "GitHub repository URL is required.");
  const sourceRef = sourceValue?.ref === undefined ? undefined : requiredString(sourceValue.ref, "source.ref", errors, "SOURCE_REF_INVALID", 1, 200);
  const subdirectory = sourceValue?.subdirectory === undefined ? undefined : requiredString(sourceValue.subdirectory, "source.subdirectory", errors, "SOURCE_SUBDIRECTORY_INVALID", 1, 300);
  if (subdirectory && (subdirectory.startsWith("/") || subdirectory.split("/").includes("..") || subdirectory.includes("\\"))) addError(errors, "SOURCE_SUBDIRECTORY_INVALID", "source.subdirectory", "Subdirectory must be a relative POSIX path inside the repository.");

  const launchValue = isRecord(input.launch) ? input.launch : undefined;
  if (!launchValue) addError(errors, "MANIFEST_FIELD_MISSING", "launch", "Launch declaration is required.");
  else checkUnknownKeys(launchValue, new Set(["surface", "entrypoint", "defaultWidth", "minWidth", "resizable", "supportsExpanded"]), "launch", errors);
  if (launchValue?.surface !== "right-window") addError(errors, "LAUNCH_SURFACE_UNSUPPORTED", "launch.surface", "Only the right-window launch surface is supported in schema version 1.");
  const entrypoint = requiredString(launchValue?.entrypoint, "launch.entrypoint", errors, "LAUNCH_ENTRYPOINT_INVALID", 1, 120);
  if (entrypoint && (entrypoint.startsWith("/") || entrypoint.split("/").includes("..") || entrypoint.includes("\\"))) addError(errors, "LAUNCH_ENTRYPOINT_INVALID", "launch.entrypoint", "Entrypoint must remain inside the package boundary.");
  const rawDefaultWidth = launchValue?.defaultWidth;
  const rawMinWidth = launchValue?.minWidth;
  const defaultWidth = integerValue(rawDefaultWidth) ? rawDefaultWidth : 380;
  const minWidth = integerValue(rawMinWidth) ? rawMinWidth : 320;
  if (rawDefaultWidth !== undefined && (!integerValue(rawDefaultWidth) || rawDefaultWidth < 320 || rawDefaultWidth > 960)) addError(errors, "LAUNCH_DEFAULT_WIDTH_INVALID", "launch.defaultWidth", "Default width must be an integer between 320 and 960 pixels.");
  if (rawMinWidth !== undefined && (!integerValue(rawMinWidth) || rawMinWidth < 320 || rawMinWidth > 960)) addError(errors, "LAUNCH_MIN_WIDTH_INVALID", "launch.minWidth", "Minimum width must be an integer between 320 and 960 pixels.");
  if (Number.isInteger(defaultWidth) && Number.isInteger(minWidth) && minWidth > defaultWidth) addError(errors, "LAUNCH_MIN_WIDTH_INVALID", "launch.minWidth", "Minimum width cannot exceed default width.");
  if (launchValue?.resizable !== undefined && typeof launchValue.resizable !== "boolean") addError(errors, "LAUNCH_FIELD_INVALID", "launch.resizable", "Resizable must be boolean.");
  if (launchValue?.supportsExpanded !== undefined && typeof launchValue.supportsExpanded !== "boolean") addError(errors, "LAUNCH_FIELD_INVALID", "launch.supportsExpanded", "Supports expanded must be boolean.");
  const resizable = typeof launchValue?.resizable === "boolean" ? launchValue.resizable : true;
  const supportsExpanded = typeof launchValue?.supportsExpanded === "boolean" ? launchValue.supportsExpanded : true;

  const normalizedPermissions = validateUniqueEnumArray(input.permissions, "permissions", permissions, errors, "PERMISSION_UNKNOWN");
  const normalizedCapabilities = validateUniqueEnumArray(input.capabilities, "capabilities", capabilities, errors, "CAPABILITY_NOT_ALLOWED");
  if (normalizedCapabilities.includes("window.resize") && !normalizedPermissions.includes("window.control")) addError(errors, "CAPABILITY_PERMISSION_CONFLICT", "capabilities", "window.resize requires window.control permission.");
  if (normalizedCapabilities.includes("window.expand") && (!normalizedPermissions.includes("window.control") || launchValue?.supportsExpanded === false)) addError(errors, "CAPABILITY_PERMISSION_CONFLICT", "capabilities", "window.expand requires window.control and supportsExpanded=true.");
  if (normalizedCapabilities.includes("repository.workspace") && !normalizedPermissions.includes("repository.read")) addError(errors, "CAPABILITY_PERMISSION_CONFLICT", "capabilities", "repository.workspace requires repository.read permission.");
  if (normalizedCapabilities.includes("agent.request") && classification !== "system") addError(errors, "CAPABILITY_NOT_ALLOWED", "capabilities", "agent.request is reserved for system packages in schema version 1.");

  let compatibility: CompatibilityDeclaration | undefined;
  if (input.compatibility !== undefined) {
    if (!isRecord(input.compatibility)) addError(errors, "COMPATIBILITY_INVALID", "compatibility", "Compatibility must be an object.");
    else {
      checkUnknownKeys(input.compatibility, new Set(["host", "api", "runtimes"]), "compatibility", errors);
      const api = isRecord(input.compatibility.api) ? input.compatibility.api : undefined;
      if (!api) addError(errors, "COMPATIBILITY_INVALID", "compatibility.api", "API compatibility declaration is required.");
      const rawMinApi = api?.minVersion;
      const rawMaxApi = api?.maxVersion;
      const minApi = integerValue(rawMinApi) ? rawMinApi : undefined;
      const maxApi = integerValue(rawMaxApi) ? rawMaxApi : undefined;
      if (!integerValue(rawMinApi) || rawMinApi < 1) addError(errors, "API_VERSION_UNSUPPORTED", "compatibility.api.minVersion", "Minimum API version must be a supported positive integer.");
      if (rawMaxApi !== undefined && (!integerValue(rawMaxApi) || rawMaxApi < (minApi ?? 1))) addError(errors, "COMPATIBILITY_INVALID", "compatibility.api.maxVersion", "Maximum API version must be greater than or equal to minimum API version.");
      if (integerValue(minApi) && minApi > SUPPORTED_MANIFEST_API_VERSION) addError(errors, "API_VERSION_UNSUPPORTED", "compatibility.api.minVersion", "Package requires an unsupported host API version.");
      const host = input.compatibility.host;
      if (host !== undefined && !isRecord(host)) addError(errors, "COMPATIBILITY_INVALID", "compatibility.host", "Host compatibility must be an object.");
      const hostMin = isRecord(host) && host.minVersion !== undefined ? validateSemver(host.minVersion, "compatibility.host.minVersion", errors, "COMPATIBILITY_INVALID") : undefined;
      const hostMax = isRecord(host) && host.maxVersion !== undefined ? validateSemver(host.maxVersion, "compatibility.host.maxVersion", errors, "COMPATIBILITY_INVALID") : undefined;
      compatibility = { api: { minVersion: minApi ?? 1, ...(integerValue(maxApi) ? { maxVersion: maxApi } : {}) }, ...(hostMin || hostMax ? { host: { ...(hostMin ? { minVersion: hostMin } : {}), ...(hostMax ? { maxVersion: hostMax } : {}) } } : {}) };
    }
  }
  if (input.integrity !== undefined) {
    if (!isRecord(input.integrity)) addError(errors, "INTEGRITY_INVALID", "integrity", "Integrity must be an object.");
    else {
      checkUnknownKeys(input.integrity, new Set(["sourceCommit", "manifestDigest", "packageDigest"]), "integrity", errors);
      if (input.integrity.sourceCommit !== undefined && (!stringValue(input.integrity.sourceCommit) || !fullCommitPattern.test(input.integrity.sourceCommit))) addError(errors, "INTEGRITY_INVALID", "integrity.sourceCommit", "Source commit must be a full 40-character commit identifier.");
      for (const field of ["manifestDigest", "packageDigest"] as const) if (input.integrity[field] !== undefined && (!stringValue(input.integrity[field]) || !/^[a-z0-9]+-[A-Za-z0-9+/=_-]+$/.test(input.integrity[field]))) addError(errors, "INTEGRITY_INVALID", `integrity.${field}`, "Digest must include an algorithm prefix.");
    }
  }
  if (input.lifecycle !== undefined && (!isRecord(input.lifecycle) || Object.keys(input.lifecycle).some((key) => !["updatePolicy", "uninstallPolicy"].includes(key)))) addError(errors, "LIFECYCLE_INVALID", "lifecycle", "Lifecycle contains unsupported fields.");
  if (isRecord(input.lifecycle) && input.lifecycle.updatePolicy !== undefined && !["manual", "compatible", "automatic"].includes(String(input.lifecycle.updatePolicy))) addError(errors, "LIFECYCLE_INVALID", "lifecycle.updatePolicy", "Update policy is invalid.");
  if (isRecord(input.lifecycle) && input.lifecycle.uninstallPolicy !== undefined && !["retain-data", "remove-data"].includes(String(input.lifecycle.uninstallPolicy))) addError(errors, "LIFECYCLE_INVALID", "lifecycle.uninstallPolicy", "Uninstall policy is invalid.");
  if (sourceRef && !/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(sourceRef) && !fullCommitPattern.test(sourceRef)) addWarning(warnings, "SOURCE_REF_NOT_REPRODUCIBLE", "source.ref", "Release packages should use a semantic tag or full commit identifier.");

  if (errors.length) return { ok: false, errors, warnings };
  const normalized: NormalizedPackageManifest = {
    ...(input as PackageManifest),
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    manifestVersion,
    id: id!,
    name: name!,
    shortName: shortName!,
    ...(description ? { description } : {}),
    app: {
      version: appVersion,
      icon: { kind: iconKind as IconKind, value: iconReference!, alt: iconAlt! },
      publisher: { id: publisherId!, name: publisherName!, ...(publisherWebsite ? { website: publisherWebsite } : {}) },
      classification: classification as PackageClass,
    },
    source: { type: "github", repository: repository!, ...(sourceRef ? { ref: sourceRef } : {}), ...(subdirectory ? { subdirectory } : {}) },
    launch: { surface: "right-window", entrypoint: entrypoint!, defaultWidth, minWidth, resizable, supportsExpanded },
    permissions: normalizedPermissions,
    capabilities: normalizedCapabilities,
    ...(compatibility ? { compatibility } : {}),
    normalized: { repository: repository!, ...(sourceRef ? { sourceRef } : {}), permissions: normalizedPermissions, capabilities: normalizedCapabilities, launch: { surface: "right-window", entrypoint: entrypoint!, defaultWidth, minWidth, resizable, supportsExpanded } },
  };
  return { ok: true, manifest: normalized, warnings };
}

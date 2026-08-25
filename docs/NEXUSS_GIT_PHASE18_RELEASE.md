# Nexuss-Git Phase 18 Host Integration

Nexuss-Agents now keeps the published Nexuss-Git release metadata in `client/src/lib/nexussGitRelease.ts`. The existing Right Window registration uses this descriptor for the app ID, display name, version, source repository, minimum width, default width, and launch behavior.

The standalone public package is:

```text
https://github.com/nexuss0781/Nexuss-Git
```

The initial package release is `v0.1.0`. Its manifest declares the right-window entrypoint `public/index.html`, a 320px minimum width, a 440px default width, and the permissions required by the repository workspace, GitHub review, CI/CD, project context, and window controls.

The host integration remains intentionally thin. Nexuss-Agents owns the launcher and sandbox runtime; Nexuss-Git owns its standalone package implementation. Future Store installation should validate the manifest, verify the GitHub source archive, install through the lifecycle manager, and launch only through the existing permission broker and runtime bridge.

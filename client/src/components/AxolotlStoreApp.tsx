import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  Download,
  ExternalLink,
  Github,
  PackageOpen,
  Pause,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { RightWindowApi } from "@/lib/rightWindowExtensions";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function AxolotlStoreApp({ api }: { api: RightWindowApi }) {
  const utils = trpc.useUtils();
  const catalogQuery = trpc.workspace.store.catalog.useQuery(undefined, {
    staleTime: 10_000,
    retry: 1,
  });
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null);
  const installMutation = trpc.workspace.store.install.useMutation({
    onSuccess: result => {
      if (!result.ok) toast.error(result.message);
      else toast.success("Nexuss-Git installed");
      void utils.workspace.store.catalog.invalidate();
    },
    onError: error => toast.error(error.message || "Installation failed."),
  });
  const actionMutation = trpc.workspace.store.action.useMutation({
    onSuccess: result => {
      if (!result.ok) toast.error(result.message);
      else toast.success("Store state updated");
      void utils.workspace.store.catalog.invalidate();
      setConfirmUninstall(null);
    },
    onError: error => toast.error(error.message || "Store action failed."),
  });
  const busy = installMutation.isPending || actionMutation.isPending;

  function runAction(
    appId: string,
    action: "enable" | "disable" | "uninstall" | "update"
  ) {
    if (action === "uninstall" && confirmUninstall !== appId) {
      setConfirmUninstall(appId);
      return;
    }
    actionMutation.mutate({ appId, action });
  }

  return (
    <div className="axolotl-store-app">
      <div className="axolotl-store-intro">
        <div className="axolotl-store-intro-icon">
          <PackageOpen size={18} />
        </div>
        <div>
          <span className="axolotl-store-eyebrow">WORKSPACE TOOLS</span>
          <h2>Axolotl Store</h2>
          <p>
            Install verified extensions. Each package is checked before it
            enters your workspace.
          </p>
        </div>
        <button
          type="button"
          className="axolotl-store-refresh"
          onClick={() => void catalogQuery.refetch()}
          disabled={catalogQuery.isFetching}
          aria-label="Refresh Store"
        >
          <RefreshCw
            size={15}
            className={catalogQuery.isFetching ? "axolotl-spin" : ""}
          />
        </button>
      </div>
      {catalogQuery.isLoading ? (
        <div className="axolotl-store-state">
          <RefreshCw size={17} className="axolotl-spin" />
          Loading Store catalog…
        </div>
      ) : catalogQuery.isError ? (
        <div className="axolotl-store-state is-error">
          <strong>Store unavailable</strong>
          <span>{catalogQuery.error.message}</span>
          <button type="button" onClick={() => void catalogQuery.refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <div className="axolotl-store-list">
          {(catalogQuery.data || []).map(app => {
            const record = app.installed;
            const installed = Boolean(record && record.state !== "uninstalled");
            const enabled = record?.state === "installed";
            const updateAvailable = Boolean(app.updateAvailable);
            const stateLabel = !installed ? "Available" : record?.state === "updating" ? "Updating" : record?.state === "failed" ? "Needs attention" : enabled ? "Enabled" : "Installed";
            return (
              <article
                key={app.id}
                className={`axolotl-store-card ${installed ? "is-installed" : ""}`}
              >
                <div className="axolotl-store-card-top">
                  <div className="axolotl-store-app-icon">
                    <Github size={22} />
                  </div>
                  <div className="axolotl-store-card-title">
                    <h3>{app.name}</h3>
                    <span>
                      {app.shortName} · v{app.version}
                    </span>
                  </div>
                  <div className="axolotl-store-statuses">
                    <span
                      className={`axolotl-store-status ${enabled ? "is-live" : installed ? "is-muted" : ""}`}
                    >
                      {stateLabel}
                    </span>
                    {updateAvailable && <span className="axolotl-store-update-badge">Update ready</span>}
                  </div>
                </div>
                <p className="axolotl-store-description">{app.description}</p>
                <div className="axolotl-store-meta">
                  <span>
                    <Check size={12} /> SHA-256 verified
                  </span>
                  <a
                    href={app.sourceRepository}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Source <ExternalLink size={11} />
                  </a>
                </div>
                <div className="axolotl-store-actions">
                  {!installed ? (
                    <button
                      type="button"
                      className="axolotl-store-primary"
                      disabled={busy}
                      onClick={() => installMutation.mutate({ appId: app.id })}
                    >
                      <Download size={14} />
                      {installMutation.isPending ? "Installing…" : "Install"}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="axolotl-store-secondary"
                        disabled={busy}
                        onClick={() =>
                          runAction(app.id, enabled ? "disable" : "enable")
                        }
                      >
                        {enabled ? <Pause size={14} /> : <Play size={14} />}
                        {enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        type="button"
                        className={`axolotl-store-secondary ${updateAvailable ? "is-update-available" : ""}`}
                        disabled={busy || !updateAvailable}
                        onClick={() => runAction(app.id, "update")}
                        title={updateAvailable ? `Update to v${app.availableVersion}` : `v${app.version} is current`}
                      >
                        <RefreshCw size={14} />
                        {updateAvailable ? `Update to v${app.availableVersion}` : "Up to date"}
                      </button>
                      <button
                        type="button"
                        className="axolotl-store-danger"
                        disabled={busy}
                        onClick={() => runAction(app.id, "uninstall")}
                      >
                        <Trash2 size={14} />
                        {confirmUninstall === app.id
                          ? "Confirm uninstall"
                          : "Uninstall"}
                      </button>
                    </>
                  )}
                </div>
                {confirmUninstall === app.id && (
                  <div className="axolotl-store-confirm">
                    <span>This removes the package but keeps app data.</span>
                    <button
                      type="button"
                      onClick={() => setConfirmUninstall(null)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      <div className="axolotl-store-footnote">
        <span>Packages are installed server-side.</span>
        <a
          href="https://github.com/nexuss0781/Nexuss-Git"
          target="_blank"
          rel="noreferrer noopener"
        >
          View package details <ArrowUpRight size={12} />
        </a>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

type SharedMeta = {
  filename: string;
  updatedAt: string;
  bytes: number;
  updatedByUserId: string | null;
};

type PersonalItem = {
  id: string;
  filename: string;
  originalName: string;
  savedAtIso: string;
  bytes: number;
};

export function HistoricalFinancialsTemplatesPanel() {
  const [sharedLoading, setSharedLoading] = useState(true);
  const [sharedExists, setSharedExists] = useState(false);
  const [sharedMeta, setSharedMeta] = useState<SharedMeta | null>(null);
  const [canUploadShared, setCanUploadShared] = useState(false);
  const [personal, setPersonal] = useState<PersonalItem[]>([]);
  const [personalLoading, setPersonalLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const refreshShared = useCallback(async () => {
    setSharedLoading(true);
    try {
      const res = await fetch("/api/historical-financials/template/shared");
      const data = (await res.json()) as {
        exists?: boolean;
        meta?: SharedMeta | null;
        canUpload?: boolean;
        error?: string;
      };
      if (res.status === 401) {
        setSharedExists(false);
        setSharedMeta(null);
        setCanUploadShared(false);
        setMsg("Sign in to use shared and personal templates.");
        return;
      }
      if (!res.ok) throw new Error(data.error || "Failed to load shared template");
      setSharedExists(Boolean(data.exists));
      setSharedMeta(data.meta ?? null);
      setCanUploadShared(Boolean(data.canUpload));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Shared template load failed");
    } finally {
      setSharedLoading(false);
    }
  }, []);

  const refreshPersonal = useCallback(async () => {
    setPersonalLoading(true);
    try {
      const res = await fetch("/api/historical-financials/template/personal");
      const data = (await res.json()) as { items?: PersonalItem[]; error?: string };
      if (res.status === 401) {
        setPersonal([]);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Failed to load personal templates");
      setPersonal(data.items ?? []);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Personal templates load failed");
    } finally {
      setPersonalLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshShared();
    void refreshPersonal();
  }, [refreshShared, refreshPersonal]);

  async function uploadShared(file: File) {
    setMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("filename", file.name);
    const res = await fetch("/api/historical-financials/template/shared", { method: "POST", body: fd });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setMsg(data.error || "Upload failed");
      return;
    }
    setMsg("Shared template updated.");
    await refreshShared();
  }

  async function uploadPersonal(file: File) {
    setMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("filename", file.name);
    const res = await fetch("/api/historical-financials/template/personal", { method: "POST", body: fd });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setMsg(data.error || "Upload failed");
      return;
    }
    setMsg("Personal template saved.");
    await refreshPersonal();
  }

  async function promotePersonalToShared(storageFilename: string) {
    setMsg(null);
    const fd = new FormData();
    fd.append("promoteFromPersonalFilename", storageFilename);
    const res = await fetch("/api/historical-financials/template/shared", { method: "POST", body: fd });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setMsg(data.error || "Could not publish as shared template");
      return;
    }
    setMsg("Shared template updated — everyone can download it from Shared template (above).");
    await refreshShared();
  }

  return (
    <div className="space-y-6">
      <p className="text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
        The first option is to spread the historical financials yourself. I promise that you will see the soul of management if you do this.
        Here are some templates you can use.
      </p>

      <div className="space-y-3 rounded border p-4" style={{ borderColor: "var(--border2)" }}>
        <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          Shared template (everyone)
        </h3>
        <p className="text-xs leading-relaxed" style={{ color: "var(--muted2)" }}>
          When an administrator uploads a workbook—or publishes one of their private templates—every signed-in user can download the same
          starting file.
        </p>
        {sharedLoading ? (
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Loading…
          </p>
        ) : sharedExists && sharedMeta ? (
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/api/historical-financials/template/shared?download=1"
              className="rounded border px-3 py-1.5 text-xs font-medium"
              style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
            >
              Download {sharedMeta.filename}
            </a>
            <span className="text-[11px]" style={{ color: "var(--muted2)" }}>
              {(sharedMeta.bytes / 1024).toFixed(0)} KB · updated {new Date(sharedMeta.updatedAt).toLocaleString()}
            </span>
          </div>
        ) : (
          <p className="text-xs" style={{ color: "var(--muted2)" }}>
            No shared template yet. An administrator can upload one after adding their user id to{" "}
            <code className="font-mono">HISTORICAL_FINANCIALS_SHARED_TEMPLATE_ADMIN_USER_IDS</code> in{" "}
            <code className="font-mono">.env.local</code>.
          </p>
        )}
        {canUploadShared && (
          <div className="space-y-2 border-t border-[var(--border2)] pt-3">
            <label className="block text-xs font-medium" style={{ color: "var(--muted2)" }}>
              Replace shared template (.xlsx)
            </label>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="block w-full text-xs"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void uploadShared(f);
              }}
            />
          </div>
        )}
      </div>

      <div className="space-y-3 rounded border p-4" style={{ borderColor: "var(--border2)" }}>
        <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          Your private templates
        </h3>
        <p className="text-xs leading-relaxed" style={{ color: "var(--muted2)" }}>
          Upload spreadsheets you like to reuse. Only you can list or download these files.
        </p>
        <label className="block text-xs font-medium" style={{ color: "var(--muted2)" }}>
          Upload .xlsx
        </label>
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="block w-full text-xs"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void uploadPersonal(f);
          }}
        />
        {personalLoading ? (
          <p className="text-xs pt-2" style={{ color: "var(--muted)" }}>
            Loading your files…
          </p>
        ) : personal.length === 0 ? (
          <p className="text-xs pt-2" style={{ color: "var(--muted2)" }}>
            No personal templates yet.
          </p>
        ) : (
          <ul className="space-y-2 pt-2">
            {personal.map((it) => (
              <li key={it.id} className="flex flex-wrap items-center gap-2 text-xs">
                <a
                  href={`/api/historical-financials/template/personal?file=${encodeURIComponent(it.filename)}`}
                  className="rounded border px-2 py-1 font-medium"
                  style={{ borderColor: "var(--border2)", color: "var(--accent)" }}
                >
                  {it.originalName}
                </a>
                <span style={{ color: "var(--muted2)" }}>{(it.bytes / 1024).toFixed(0)} KB</span>
                {canUploadShared && (
                  <button
                    type="button"
                    onClick={() => void promotePersonalToShared(it.filename)}
                    className="rounded border px-2 py-1 font-medium"
                    style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
                  >
                    Use as shared template for everyone
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {msg && (
        <p className="text-xs" style={{ color: "var(--muted2)" }}>
          {msg}
        </p>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

type PersonalItem = {
  id: string;
  filename: string;
  originalName: string;
  savedAtIso: string;
  bytes: number;
};

/** Static community workbook in public/historical-financials/ — served to everyone. */
const COMMUNITY_TEMPLATE_PUBLIC_PATH = "/historical-financials/Financial Model - template.xlsx";
const COMMUNITY_TEMPLATE_FILENAME = "Financial Model - template.xlsx";

async function readJsonResponse<T>(res: Response): Promise<
  | { ok: true; data: T }
  | { ok: false; error: string }
> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: res.ok ? "Empty response from server" : `Request failed (${res.status})`,
    };
  }
  try {
    return { ok: true, data: JSON.parse(trimmed) as T };
  } catch {
    return {
      ok: false,
      error: "Something went wrong loading your templates.",
    };
  }
}

export function HistoricalFinancialsTemplatesPanel() {
  const { status } = useSession();
  const [personal, setPersonal] = useState<PersonalItem[]>([]);
  const [personalLoading, setPersonalLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const refreshPersonal = useCallback(async () => {
    if (status !== "authenticated") {
      setPersonal([]);
      setPersonalLoading(false);
      return;
    }
    setPersonalLoading(true);
    try {
      const res = await fetch("/api/historical-financials/template/personal");
      const parsed = await readJsonResponse<{ items?: PersonalItem[]; error?: string }>(res);
      if (!parsed.ok) {
        setMsg(parsed.error);
        setPersonal([]);
        return;
      }
      const data = parsed.data;
      if (res.status === 401) {
        setPersonal([]);
        return;
      }
      if (!res.ok) {
        setMsg(data.error || "Failed to load your templates");
        setPersonal([]);
        return;
      }
      setPersonal(data.items ?? []);
      setMsg(null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to load your templates");
      setPersonal([]);
    } finally {
      setPersonalLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void refreshPersonal();
  }, [refreshPersonal]);

  async function uploadPersonal(file: File) {
    if (status !== "authenticated") return;
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("filename", file.name);
      const res = await fetch("/api/historical-financials/template/personal", { method: "POST", body: fd });
      const parsed = await readJsonResponse<{ error?: string }>(res);
      if (!parsed.ok) {
        setMsg(parsed.error);
        return;
      }
      const data = parsed.data;
      if (!res.ok) {
        setMsg(data.error || "Upload failed");
        return;
      }
      setMsg(null);
      await refreshPersonal();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Upload failed");
    }
  }

  const signedIn = status === "authenticated";

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Community template
        </p>
        <a
          href={encodeURI(COMMUNITY_TEMPLATE_PUBLIC_PATH)}
          download={COMMUNITY_TEMPLATE_FILENAME}
          className="inline-flex rounded border px-3 py-1.5 text-xs font-medium"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
        >
          Download {COMMUNITY_TEMPLATE_FILENAME}
        </a>
      </div>

      <div className="space-y-3 border-t pt-6" style={{ borderColor: "var(--border2)" }}>
        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Your templates
        </p>
        {!signedIn ? (
          <p className="text-xs" style={{ color: "var(--muted2)" }}>
            Sign in to upload your own .xlsx files.
          </p>
        ) : (
          <>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="block w-full max-w-md text-xs"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void uploadPersonal(f);
              }}
            />
            {personalLoading ? (
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                Loading…
              </p>
            ) : personal.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--muted2)" }}>
                No files yet.
              </p>
            ) : (
              <ul className="space-y-2">
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
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {msg ? (
        <p className="text-xs" style={{ color: "var(--muted2)" }}>
          {msg}
        </p>
      ) : null}
    </div>
  );
}

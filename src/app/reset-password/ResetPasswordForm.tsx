"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function ResetPasswordFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (!token) {
      setError("Invalid or missing reset link.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Could not reset password.");
        return;
      }
      router.push("/login?reset=1");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="w-full max-w-sm text-center">
        <h1 className="text-xl font-semibold tracking-tight">Reset password</h1>
        <p className="mt-4 text-sm" style={{ color: "var(--accent)" }}>
          Invalid or missing reset link. Request a new one from the sign-in page.
        </p>
        <Link href="/forgot-password" className="mt-6 inline-block text-sm underline underline-offset-2" style={{ color: "var(--accent)" }}>
          Forgot password
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-center text-xl font-semibold tracking-tight">New password</h1>
      <p className="mt-2 text-center text-sm" style={{ color: "var(--muted)" }}>
        Choose a new password (8+ characters).
      </p>
      <form onSubmit={(e) => void onSubmit(e)} className="mt-6 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: "var(--muted)" }}>New password</span>
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border px-3 py-2 text-base"
            style={{ borderColor: "var(--border)", background: "var(--sb)", color: "var(--text)" }}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: "var(--muted)" }}>Confirm password</span>
          <input
            type="password"
            name="confirm"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="rounded-md border px-3 py-2 text-base"
            style={{ borderColor: "var(--border)", background: "var(--sb)", color: "var(--text)" }}
          />
        </label>
        {error && (
          <p className="text-sm" style={{ color: "var(--accent)" }}>
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="btn-shell hi mt-2 rounded-md py-2.5 text-sm font-medium disabled:opacity-60"
        >
          {loading ? "Saving…" : "Update password"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm" style={{ color: "var(--muted)" }}>
        <Link href="/login" className="font-medium underline underline-offset-2" style={{ color: "var(--accent)" }}>
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

export function ResetPasswordForm() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-4"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <Suspense
        fallback={
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Loading…
          </p>
        }
      >
        <ResetPasswordFormInner />
      </Suspense>
    </div>
  );
}

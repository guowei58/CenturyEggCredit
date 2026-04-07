"use client";

import Link from "next/link";
import { useState } from "react";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }
      setDone(true);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-4"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <div className="w-full max-w-sm">
        <h1 className="text-center text-xl font-semibold tracking-tight">Forgot password</h1>
        <p className="mt-2 text-center text-sm" style={{ color: "var(--muted)" }}>
          Enter your email. If an account exists, we will send reset instructions (or a sign-up confirmation if you have not verified yet).
        </p>

        {done ? (
          <p className="mt-6 text-center text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            If an account exists for that email, you will receive instructions shortly. Check your inbox and spam folder.
          </p>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} className="mt-6 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span style={{ color: "var(--muted)" }}>Email</span>
              <input
                type="email"
                name="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm" style={{ color: "var(--muted)" }}>
          <Link href="/login" className="font-medium underline underline-offset-2" style={{ color: "var(--accent)" }}>
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

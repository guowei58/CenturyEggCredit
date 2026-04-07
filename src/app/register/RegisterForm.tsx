"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function RegisterForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
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
    setLoading(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const text = await res.text();
      let data: { error?: string } = {};
      try {
        data = text ? (JSON.parse(text) as { error?: string }) : {};
      } catch {
        setError(`Server error (${res.status}). Open Vercel → project → Logs if this keeps happening.`);
        return;
      }
      if (!res.ok) {
        setError(data.error || "Could not create account.");
        return;
      }
      router.push("/login?checkEmail=1");
      router.refresh();
    } catch {
      setError("Network error. Check your connection and try again.");
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
        <h1 className="text-center text-xl font-semibold tracking-tight">Create account</h1>
        <p className="mt-2 text-center text-sm" style={{ color: "var(--muted)" }}>
          We will email you a confirmation link. You can sign in only after you confirm your email.
        </p>
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
          <label className="flex flex-col gap-1 text-sm">
            <span style={{ color: "var(--muted)" }}>Password (8+ characters)</span>
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
            {loading ? "Creating…" : "Sign up"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm" style={{ color: "var(--muted)" }}>
          Already have an account?{" "}
          <Link href="/login" className="font-medium underline underline-offset-2" style={{ color: "var(--accent)" }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

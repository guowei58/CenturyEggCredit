"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";

export function LoginForm({ justRegistered }: { justRegistered: boolean }) {

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });
      if (res?.error) {
        setError("Wrong email or password.");
        return;
      }
      if (res?.url) {
        window.location.href = res.url;
        return;
      }
      window.location.href = "/";
    } catch {
      setError("Something went wrong. Try again.");
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
        <h1 className="text-center text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-center text-sm" style={{ color: "var(--muted)" }}>
          Use the email and password you chose at sign up.
        </p>
        {justRegistered && (
          <p className="mt-3 text-center text-sm" style={{ color: "var(--accent)" }}>
            Account created. Sign in below.
          </p>
        )}
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
            <span style={{ color: "var(--muted)" }}>Password</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm" style={{ color: "var(--muted)" }}>
          New here?{" "}
          <Link
            href="/register"
            className="font-medium underline underline-offset-2"
            style={{ color: "var(--accent)" }}
          >
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}

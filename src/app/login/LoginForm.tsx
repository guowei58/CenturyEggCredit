"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";

export function LoginForm({
  checkEmail,
  resetOk,
}: {
  checkEmail: boolean;
  resetOk: boolean;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [showUnverifiedHelp, setShowUnverifiedHelp] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResendMsg(null);
    setShowUnverifiedHelp(false);
    setLoading(true);
    try {
      const res = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });
      // NextAuth v5: failed credentials often return HTTP 200 with `error` in the callback URL, so `ok` is still true.
      if (res?.error) {
        if (res.code === "email_not_verified") {
          setError("Confirm your email before signing in. Check your inbox for the link we sent when you registered.");
          setShowUnverifiedHelp(true);
          return;
        }
        setError("Wrong email or password.");
        return;
      }
      if (!res?.ok) {
        setError("Could not sign you in. Check your connection and try again.");
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

  async function resendVerification() {
    const emailTrim = email.trim().toLowerCase();
    if (!emailTrim) {
      setResendMsg("Enter your email in the field above, then click resend.");
      return;
    }
    setResendMsg(null);
    setResendLoading(true);
    try {
      const r = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailTrim }),
      });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) {
        setResendMsg(data.error || "Could not resend.");
        return;
      }
      setResendMsg("If this account is still unverified, we sent a new confirmation email.");
    } catch {
      setResendMsg("Network error. Try again.");
    } finally {
      setResendLoading(false);
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
        {checkEmail && (
          <p className="mt-3 text-center text-sm leading-relaxed" style={{ color: "var(--accent)" }}>
            Check your email for a confirmation link (including your junk or spam folder). You must confirm before you
            can sign in.
          </p>
        )}
        {resetOk && (
          <p className="mt-3 text-center text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Password updated. Sign in with your new password.
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
          <div className="text-right">
            <Link href="/forgot-password" className="text-xs font-medium underline underline-offset-2" style={{ color: "var(--accent)" }}>
              Forgot password?
            </Link>
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-md border px-3 py-2 text-sm font-medium"
              style={{ color: "var(--danger)", borderColor: "rgba(239, 68, 68, 0.45)", background: "rgba(239, 68, 68, 0.08)" }}
            >
              {error}
            </p>
          )}
          {showUnverifiedHelp && (
            <div className="rounded-md border px-3 py-2 text-xs leading-relaxed" style={{ borderColor: "var(--border2)", color: "var(--muted)" }}>
              <button
                type="button"
                disabled={resendLoading}
                onClick={() => void resendVerification()}
                className="font-medium underline underline-offset-2 disabled:opacity-60"
                style={{ color: "var(--accent)" }}
              >
                {resendLoading ? "Sending…" : "Resend confirmation email"}
              </button>
              {resendMsg && <p className="mt-2">{resendMsg}</p>}
            </div>
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

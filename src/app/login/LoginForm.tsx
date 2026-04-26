"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";

import { LOGO_MARK_CELL_BG } from "@/components/layout/logoMarkCellStyle";

const CENTURY_EGG_MARK = "/century-egg-mark.png";

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
      className="flex min-h-screen flex-col px-4"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <div className="flex w-full shrink-0 justify-center pt-8 sm:pt-10">
        <div className="grid max-w-[min(100%,22rem)] grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_auto_auto] gap-x-3 gap-y-1 sm:gap-x-3.5">
          <div
            className="col-start-1 row-span-3 row-start-1 grid size-[4.5rem] shrink-0 place-items-center overflow-hidden sm:size-[5rem]"
            style={LOGO_MARK_CELL_BG}
            aria-hidden
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- static asset from /public */}
            <img
              src={CENTURY_EGG_MARK}
              alt=""
              className="h-full w-full object-contain object-center mix-blend-multiply contrast-[1.08]"
              draggable={false}
            />
          </div>
          <div className="col-start-2 row-start-1 flex min-w-0 flex-col gap-1 self-start leading-tight sm:gap-1.5">
            <span className="text-base font-bold tracking-tight sm:text-lg" style={{ color: "var(--text)" }}>
              OREO
            </span>
            <div className="h-px w-full shrink-0" style={{ background: "var(--accent)" }} />
          </div>
          <div className="col-start-2 row-start-2 min-w-0 self-start">
            <span
              className="text-[10px] font-normal leading-snug sm:text-[11px]"
              style={{ color: "var(--text)" }}
            >
              <span style={{ color: "var(--accent)" }}>O</span>rganized <span style={{ color: "var(--accent)" }}>R</span>esearch,{" "}
              <span style={{ color: "var(--accent)" }}>E</span>xposure &amp; <span style={{ color: "var(--accent)" }}>O</span>utlook
            </span>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center pb-12">
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
    </div>
  );
}

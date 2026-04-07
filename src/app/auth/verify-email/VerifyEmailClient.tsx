"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export function VerifyEmailClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "already" | "err">("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("err");
      setMessage("Missing confirmation token. Open the link from your email, or request a new message from the sign-in page.");
      return;
    }

    let cancelled = false;
    setStatus("loading");
    void (async () => {
      try {
        const res = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = (await res.json()) as { error?: string; alreadyVerified?: boolean };
        if (cancelled) return;
        if (!res.ok) {
          setStatus("err");
          setMessage(data.error || "Could not confirm email.");
          return;
        }
        if (data.alreadyVerified) {
          setStatus("already");
          setMessage("This email is already confirmed. You can sign in.");
          return;
        }
        setStatus("ok");
        setMessage("Your email is confirmed. You can sign in.");
      } catch {
        if (!cancelled) {
          setStatus("err");
          setMessage("Network error. Try again.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-4"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <div className="w-full max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight">Confirm email</h1>
        {status === "loading" && (
          <p className="mt-4 text-sm" style={{ color: "var(--muted)" }}>
            Confirming…
          </p>
        )}
        {(status === "ok" || status === "already" || status === "err") && message && (
          <p
            className="mt-4 text-sm leading-relaxed"
            style={{ color: status === "err" ? "var(--accent)" : "var(--muted)" }}
          >
            {message}
          </p>
        )}
        {(status === "ok" || status === "already") && (
          <Link
            href="/login"
            className="mt-6 inline-block rounded-md border px-4 py-2 text-sm font-medium"
            style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
          >
            Sign in
          </Link>
        )}
        {status === "err" && (
          <Link href="/login" className="mt-6 block text-sm underline underline-offset-2" style={{ color: "var(--accent)" }}>
            Back to sign in
          </Link>
        )}
      </div>
    </div>
  );
}

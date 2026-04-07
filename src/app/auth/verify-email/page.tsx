import { Suspense } from "react";

import { VerifyEmailClient } from "./VerifyEmailClient";

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div
          className="flex min-h-screen flex-col items-center justify-center px-4"
          style={{ background: "var(--bg)", color: "var(--text)" }}
        >
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Loading…
          </p>
        </div>
      }
    >
      <VerifyEmailClient />
    </Suspense>
  );
}

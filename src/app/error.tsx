"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 py-12 text-center"
      style={{
        background: "var(--bg, #07090d)",
        color: "var(--text, #e2e8f4)",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 className="text-lg font-semibold" style={{ color: "var(--text, #e2e8f4)" }}>
        Something went wrong
      </h1>
      <p className="max-w-md text-sm leading-relaxed" style={{ color: "var(--muted2, #94a3b8)" }}>
        {error.message || "The app hit an unexpected error. Try reloading or clearing the Next cache."}
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-md px-4 py-2 text-sm font-semibold text-black"
        style={{ background: "var(--accent, #00d4aa)" }}
      >
        Try again
      </button>
    </div>
  );
}

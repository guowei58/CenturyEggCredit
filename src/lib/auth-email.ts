/**
 * Transactional email for signup verification and password reset.
 * Production: set RESEND_API_KEY and EMAIL_FROM (see .env.example).
 * Development without Resend: links are logged to the server console.
 */

export function getAppBaseUrl(): string {
  const a = process.env.AUTH_URL?.trim() || process.env.NEXTAUTH_URL?.trim();
  if (a) return a.replace(/\/$/, "");
  const v = process.env.VERCEL_URL?.trim();
  if (v) return `https://${v.replace(/^https?:\/\//, "")}`;
  return "http://localhost:3000";
}

export async function sendTransactionalEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim() || "Century Egg <onboarding@resend.dev>";

  if (!key) {
    console.warn(
      "[auth-email] RESEND_API_KEY not set — email not sent. Configure Resend for production.\n" +
        `To: ${opts.to}\nSubject: ${opts.subject}\n\n${opts.text}`
    );
    if (process.env.NODE_ENV === "production") {
      return { ok: false, error: "Email is not configured (set RESEND_API_KEY and EMAIL_FROM)." };
    }
    return { ok: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        text: opts.text,
        html: opts.html ?? opts.text.split("\n").map((line) => (line ? `<p>${escapeHtml(line)}</p>` : "<br/>")).join(""),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) {
      return { ok: false, error: body.message || `Resend HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Send failed" };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

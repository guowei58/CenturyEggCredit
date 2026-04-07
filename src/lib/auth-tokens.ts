import { randomBytes } from "crypto";

import { prisma } from "@/lib/prisma";
import { getAppBaseUrl, sendTransactionalEmail } from "@/lib/auth-email";

export const EMAIL_VERIFICATION_IDENTIFIER_PREFIX = "email_verification:";
export const PASSWORD_RESET_IDENTIFIER_PREFIX = "password_reset:";

export function emailVerificationIdentifier(email: string): string {
  return `${EMAIL_VERIFICATION_IDENTIFIER_PREFIX}${email.trim().toLowerCase()}`;
}

export function passwordResetIdentifier(email: string): string {
  return `${PASSWORD_RESET_IDENTIFIER_PREFIX}${email.trim().toLowerCase()}`;
}

export function parseEmailFromVerificationIdentifier(identifier: string): string | null {
  if (!identifier.startsWith(EMAIL_VERIFICATION_IDENTIFIER_PREFIX)) return null;
  return identifier.slice(EMAIL_VERIFICATION_IDENTIFIER_PREFIX.length) || null;
}

export function parseEmailFromResetIdentifier(identifier: string): string | null {
  if (!identifier.startsWith(PASSWORD_RESET_IDENTIFIER_PREFIX)) return null;
  return identifier.slice(PASSWORD_RESET_IDENTIFIER_PREFIX.length) || null;
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function sendSignupVerificationEmail(
  email: string,
  token: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = getAppBaseUrl();
  const link = `${base}/auth/verify-email?token=${encodeURIComponent(token)}`;
  return sendTransactionalEmail({
    to: email,
    subject: "Confirm your Century Egg account",
    text: `Welcome — please confirm your email to finish signing up.\n\nOpen this link (or paste it into your browser):\n${link}\n\nThis link expires in 48 hours. If you did not create an account, you can ignore this message.`,
    html: `<p>Welcome — please confirm your email to finish signing up.</p><p><a href="${link}">Confirm email</a></p><p style="font-size:12px;color:#666">Or copy: ${link}</p><p style="font-size:12px;color:#666">This link expires in 48 hours.</p>`,
  });
}

export async function sendPasswordResetEmail(
  email: string,
  token: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = getAppBaseUrl();
  const link = `${base}/reset-password?token=${encodeURIComponent(token)}`;
  return sendTransactionalEmail({
    to: email,
    subject: "Reset your Century Egg password",
    text: `We received a request to reset your password.\n\nOpen this link:\n${link}\n\nThis link expires in 1 hour. If you did not ask for a reset, ignore this email.`,
    html: `<p>We received a request to reset your password.</p><p><a href="${link}">Reset password</a></p><p style="font-size:12px;color:#666">This link expires in 1 hour.</p>`,
  });
}

export async function issueEmailVerificationToken(email: string): Promise<{ token: string }> {
  const identifier = emailVerificationIdentifier(email);
  await prisma.verificationToken.deleteMany({ where: { identifier } });
  const token = createOpaqueToken();
  const expires = new Date(Date.now() + 48 * 60 * 60 * 1000);
  await prisma.verificationToken.create({
    data: { identifier, token, expires },
  });
  return { token };
}

export async function issuePasswordResetToken(email: string): Promise<{ token: string }> {
  const identifier = passwordResetIdentifier(email);
  await prisma.verificationToken.deleteMany({ where: { identifier } });
  const token = createOpaqueToken();
  const expires = new Date(Date.now() + 60 * 60 * 1000);
  await prisma.verificationToken.create({
    data: { identifier, token, expires },
  });
  return { token };
}

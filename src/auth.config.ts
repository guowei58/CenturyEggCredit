import type { NextAuthConfig } from "next-auth";
import { NextResponse } from "next/server";
import GitHub from "next-auth/providers/github";

const githubConfigured =
  Boolean(process.env.AUTH_GITHUB_ID?.trim()) && Boolean(process.env.AUTH_GITHUB_SECRET?.trim());

export default {
  trustHost: true,
  pages: { signIn: "/login" },
  providers: githubConfigured
    ? [
        GitHub({
          clientId: process.env.AUTH_GITHUB_ID!,
          clientSecret: process.env.AUTH_GITHUB_SECRET!,
        }),
      ]
    : [],
  callbacks: {
    async authorized({ request, auth }) {
      const path = request.nextUrl.pathname;

      if (path.startsWith("/api/auth")) return true;
      if (path === "/api/register") return true;

      const isAuthPage = path.startsWith("/login") || path.startsWith("/register");
      if (isAuthPage) {
        if (auth?.user) {
          return Response.redirect(new URL("/", request.nextUrl));
        }
        return true;
      }

      if (!auth?.user) {
        if (path.startsWith("/api/")) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const login = new URL("/login", request.nextUrl);
        if (path !== "/") login.searchParams.set("callbackUrl", `${path}${request.nextUrl.search}`);
        return NextResponse.redirect(login);
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

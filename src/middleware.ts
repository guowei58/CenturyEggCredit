import NextAuth from "next-auth";
import authConfig from "@/auth.config";

const { auth } = NextAuth(authConfig);

export { auth as middleware };

export const config = {
  /** Run on pages and API. Skip Next internals, static assets, and favicon. Auth + register APIs stay public via `authorized` in auth.config. */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};

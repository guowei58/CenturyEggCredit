import type { Metadata } from "next";
import "./globals.css";
import { rootHtmlStyle } from "./root-theme";
import { AuthSessionProvider } from "@/components/AuthSessionProvider";

export const metadata: Metadata = {
  title: "CenturyEggCredit — Corporate Credit Research",
  description: "CenturyEggCredit dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" style={rootHtmlStyle}>
      <body
        className="antialiased"
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "var(--bg)",
          color: "var(--text)",
        }}
      >
        <AuthSessionProvider>{children}</AuthSessionProvider>
      </body>
    </html>
  );
}

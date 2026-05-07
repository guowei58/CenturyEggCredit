import { auth } from "@/auth";
import AppShellClient from "@/app/shell/AppShellClient";
import { LandingPage } from "@/components/marketing/LandingPage";

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.id) return <LandingPage />;
  return <AppShellClient />;
}

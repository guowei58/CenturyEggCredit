import { LoginForm } from "./LoginForm";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const githubReady =
    Boolean(process.env.AUTH_GITHUB_ID?.trim()) && Boolean(process.env.AUTH_GITHUB_SECRET?.trim());
  const justRegistered = searchParams.registered === "1";

  return <LoginForm githubReady={githubReady} justRegistered={justRegistered} />;
}

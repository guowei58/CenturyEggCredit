import { LoginForm } from "./LoginForm";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const justRegistered = searchParams.registered === "1";

  return <LoginForm justRegistered={justRegistered} />;
}

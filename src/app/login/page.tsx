import { LoginForm } from "./LoginForm";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const checkEmail = searchParams.checkEmail === "1";
  const resetOk = searchParams.reset === "1";

  return <LoginForm checkEmail={checkEmail} resetOk={resetOk} />;
}

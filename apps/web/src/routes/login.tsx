import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Bookmark, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { getSupabase } from "../lib/supabase";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const supabase = await getSupabase();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setErrorMessage("이메일 또는 비밀번호가 올바르지 않습니다");
        return;
      }

      await navigate({ to: "/" });
    } catch {
      setErrorMessage(
        "로그인 처리를 시작하지 못했어요. 네트워크 상태를 확인하고 다시 시도해주세요.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <form
        className="dialog-surface w-full max-w-sm rounded-[1.75rem] p-6 sm:p-7"
        onSubmit={handleSubmit}
      >
        <div className="mb-7 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-[1rem] bg-blue-600 text-white shadow-lg shadow-blue-500/20 dark:bg-blue-500">
            <Bookmark className="h-7 w-7" />
          </span>
          <p className="mt-4 text-sm font-semibold text-blue-600 dark:text-blue-400">
            My Bookmark
          </p>
          <h1 className="mt-1 text-[1.75rem] font-bold tracking-[-0.03em]">
            다시 오신 것을 환영해요
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            나만의 라이브러리에 안전하게 로그인하세요.
          </p>
        </div>

        <label className="block text-sm font-medium" htmlFor="email">
          이메일
        </label>
        <input
          autoComplete="email"
          className="input mt-2"
          id="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />

        <label className="mt-4 block text-sm font-medium" htmlFor="password">
          비밀번호
        </label>
        <input
          autoComplete="current-password"
          className="input mt-2"
          id="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />

        {errorMessage ? (
          <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">
            {errorMessage}
          </p>
        ) : null}

        <button
          className="btn-primary mt-6 w-full justify-center"
          disabled={isSubmitting}
          type="submit"
        >
          <LockKeyhole className="h-4 w-4" />
          {isSubmitting ? "로그인 중…" : "로그인"}
        </button>
      </form>
    </main>
  );
}

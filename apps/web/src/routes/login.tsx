import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <form
        className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
        onSubmit={handleSubmit}
      >
        <div className="mb-6 text-center">
          <p className="text-sm font-medium text-blue-600">My Bookmark</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-950">
            로그인
          </h1>
        </div>

        <label
          className="block text-sm font-medium text-zinc-700"
          htmlFor="email"
        >
          이메일
        </label>
        <input
          autoComplete="email"
          className="mt-2 h-11 w-full rounded-xl border border-zinc-300 px-3 text-zinc-950 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          id="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />

        <label
          className="mt-4 block text-sm font-medium text-zinc-700"
          htmlFor="password"
        >
          비밀번호
        </label>
        <input
          autoComplete="current-password"
          className="mt-2 h-11 w-full rounded-xl border border-zinc-300 px-3 text-zinc-950 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          id="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />

        {errorMessage ? (
          <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage}
          </p>
        ) : null}

        <button
          className="mt-6 h-11 w-full rounded-xl bg-blue-600 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "로그인 중…" : "로그인"}
        </button>
      </form>
    </main>
  );
}

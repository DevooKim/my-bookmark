import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { getMe } from "../../lib/api-client";

export const Route = createFileRoute("/_authed/")({ component: HomePage });

function HomePage() {
  const meQuery = useQuery({ queryKey: ["me"], queryFn: getMe });

  return (
    <main className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">
        Phase 1
      </p>
      <h1 className="text-3xl font-bold tracking-tight text-zinc-950">
        로그인된 북마크 앱
      </h1>
      <p className="mt-3 text-zinc-600">
        DB와 인증 기반이 준비되었습니다. 북마크 기능은 다음 Phase에서
        추가됩니다.
      </p>
      <div className="mt-6 rounded-xl bg-zinc-50 p-4 text-sm text-zinc-700">
        <span className="font-medium">API 인증 확인: </span>
        {meQuery.isLoading ? "확인 중…" : null}
        {meQuery.data ? meQuery.data.userId : null}
        {meQuery.isError ? "실패" : null}
      </div>
    </main>
  );
}

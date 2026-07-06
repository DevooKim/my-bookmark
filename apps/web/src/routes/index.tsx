import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: HomePage });

function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
      <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
        Phase 0
      </p>
      <h1 className="text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">
        My Bookmark
      </h1>
      <p className="mt-4 text-lg text-slate-600">
        개인 북마크 관리 앱의 기반 스캐폴딩이 준비되었습니다.
      </p>
    </main>
  );
}

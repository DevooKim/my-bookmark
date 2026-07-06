import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { getMe } from "../../lib/api-client";
import { supabase } from "../../lib/supabase";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async () => {
    if (typeof window === "undefined") {
      return;
    }

    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/login" });
    }
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const queryClient = useQueryClient();
  const meQuery = useQuery({ queryKey: ["me"], queryFn: getMe });

  async function handleLogout() {
    await supabase.auth.signOut();
    queryClient.clear();
    window.location.assign("/login");
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link className="text-lg font-bold" to="/">
            My Bookmark
          </Link>
          <nav className="hidden items-center gap-4 text-sm text-zinc-600 sm:flex">
            <Link activeProps={{ className: "text-blue-600" }} to="/">
              홈
            </Link>
            <span className="text-zinc-300">리마인더</span>
            <span className="text-zinc-300">설정</span>
          </nav>
          <button
            className="rounded-xl border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100"
            onClick={handleLogout}
            type="button"
          >
            로그아웃
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8">
        {meQuery.isError ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            인증 정보를 확인할 수 없습니다. 다시 로그인해주세요.
          </div>
        ) : null}
        <Outlet />
      </div>
    </div>
  );
}

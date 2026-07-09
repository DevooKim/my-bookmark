import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Bookmark, Clock, Home, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { getMe } from "../../lib/api-client";
import { clearServiceWorkerApiCache } from "../../lib/service-worker";
import { supabase } from "../../lib/supabase";

export const Route = createFileRoute("/_authed")({
  ssr: false,
  component: AuthedLayout,
});

function AuthedLayout() {
  const queryClient = useQueryClient();
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    enabled: !isCheckingSession,
  });

  useEffect(() => {
    let isMounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) {
        return;
      }
      if (!data.session) {
        window.location.assign("/login");
        return;
      }
      setIsCheckingSession(false);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    await clearServiceWorkerApiCache();
    queryClient.clear();
    window.location.assign("/login");
  }

  if (isCheckingSession) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
        인증 상태를 확인하는 중…
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 pb-20 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50 sm:pb-0">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link className="flex items-center gap-2 text-lg font-bold" to="/">
            <Bookmark className="h-5 w-5 text-blue-600" />
            My Bookmark
          </Link>
          <nav className="hidden items-center gap-4 text-sm text-zinc-600 dark:text-zinc-300 sm:flex">
            <NavLink to="/">홈</NavLink>
            <NavLink to="/reminders">리마인더</NavLink>
            <NavLink to="/settings">설정</NavLink>
          </nav>
          <button
            className="rounded-xl border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            onClick={handleLogout}
            type="button"
          >
            로그아웃
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
        {meQuery.isError ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            인증 정보를 확인할 수 없습니다. 다시 로그인해주세요.
          </div>
        ) : null}
        <Outlet />
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-zinc-200 bg-white text-xs dark:border-zinc-800 dark:bg-zinc-950 sm:hidden">
        <MobileNavLink icon={<Home className="h-5 w-5" />} label="홈" to="/" />
        <MobileNavLink
          icon={<Clock className="h-5 w-5" />}
          label="리마인더"
          to="/reminders"
        />
        <MobileNavLink
          icon={<Settings className="h-5 w-5" />}
          label="설정"
          to="/settings"
        />
      </nav>
    </div>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link activeProps={{ className: "text-blue-600" }} to={to}>
      {children}
    </Link>
  );
}

function MobileNavLink({
  to,
  icon,
  label,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      activeProps={{ className: "text-blue-600" }}
      className="flex min-h-16 flex-col items-center justify-center gap-1 text-zinc-500"
      to={to}
    >
      {icon}
      {label}
    </Link>
  );
}

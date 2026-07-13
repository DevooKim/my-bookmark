import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
} from "@tanstack/react-router";
import {
  Bookmark,
  Clock,
  Library,
  LogOut,
  Menu,
  Plus,
  Settings,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getMe } from "../../lib/api-client";
import { loginUrlForLocation } from "../../lib/auth-redirect";
import { requestBookmarkDialog } from "../../lib/bookmark-dialog";
import { performLogout } from "../../lib/logout";
import { getSupabase } from "../../lib/supabase";

export const Route = createFileRoute("/_authed")({
  ssr: false,
  component: AuthedLayout,
});

function AuthedLayout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    enabled: !isCheckingSession,
  });

  useEffect(() => {
    let isMounted = true;
    void getSupabase()
      .then((supabase) => supabase.auth.getSession())
      .then(({ data }) => {
        if (!isMounted) {
          return;
        }
        if (!data.session) {
          window.location.assign(loginUrlForLocation(window.location));
          return;
        }
        setIsCheckingSession(false);
      })
      .catch(() => {
        // chunk load failure: fall through so meQuery's error banner shows
        // instead of spinning on "인증 상태를 확인하는 중" forever
        if (isMounted) {
          setIsCheckingSession(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  async function handleLogout() {
    await performLogout(queryClient);
  }

  async function handleAddBookmark() {
    await navigate({ to: "/" });
    requestBookmarkDialog();
  }

  if (isCheckingSession) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
        <div className="surface">인증 상태를 확인하는 중…</div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="glass-header hidden sm:block">
        <div className="glass-header-inner">
          <Link className="brand-mark" to="/">
            <span className="brand-icon">
              <Bookmark className="h-4 w-4" />
            </span>
            <span className="hidden sm:inline">My Bookmark</span>
          </Link>
          <DesktopMenu
            onLogout={() => void handleLogout()}
            onNavigate={(to) => void navigate({ to })}
          />
        </div>
      </header>

      <div className="content-frame">
        {meQuery.isError ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            인증 정보를 확인할 수 없습니다. 다시 로그인해주세요.
          </div>
        ) : null}
        <Outlet />
      </div>

      <nav aria-label="모바일 주요 메뉴" className="mobile-tab-bar">
        <MobileNavLink
          icon={<Library className="h-5 w-5" />}
          label="라이브러리"
          to="/"
        />
        <MobileNavLink
          icon={<Clock className="h-5 w-5" />}
          label="리마인더"
          to="/reminders"
        />
        <button
          aria-label="북마크 추가"
          className="mobile-add-action"
          onClick={() => void handleAddBookmark()}
          type="button"
        >
          <span className="mobile-add-icon">
            <Plus className="h-5 w-5" />
          </span>
          추가
        </button>
        <MobileNavLink
          icon={<Settings className="h-5 w-5" />}
          label="설정"
          to="/settings"
        />
      </nav>
    </div>
  );
}

type DesktopDestination = "/" | "/reminders" | "/settings";

export function DesktopMenu({
  onLogout,
  onNavigate,
}: {
  onLogout: () => void;
  onNavigate: (to: DesktopDestination) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const dismissOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissWithEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissWithEscape);
    };
  }, [open]);

  const runAction = (action: () => void) => {
    setOpen(false);
    triggerRef.current?.focus();
    action();
  };

  return (
    <div className="relative hidden sm:block" ref={menuRef}>
      <button
        aria-expanded={open}
        aria-controls="desktop-menu-popover"
        aria-label="데스크톱 메뉴"
        className="icon-button"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <Menu className="h-5 w-5" />
      </button>
      {open ? (
        <nav
          aria-label="데스크톱 메뉴 항목"
          className="popover-surface"
          id="desktop-menu-popover"
        >
          <button
            className="menu-item"
            onClick={() => runAction(() => onNavigate("/"))}
            type="button"
          >
            <Library className="h-4 w-4" /> 라이브러리
          </button>
          <button
            className="menu-item"
            onClick={() => runAction(() => onNavigate("/reminders"))}
            type="button"
          >
            <Clock className="h-4 w-4" /> 리마인더
          </button>
          <button
            className="menu-item"
            onClick={() => runAction(() => onNavigate("/settings"))}
            type="button"
          >
            <Settings className="h-4 w-4" /> 설정
          </button>
          <div
            className="my-1 border-t"
            style={{ borderColor: "var(--line)" }}
          />
          <button
            className="menu-item text-red-600 dark:text-red-400"
            onClick={() => runAction(onLogout)}
            type="button"
          >
            <LogOut className="h-4 w-4" /> 로그아웃
          </button>
        </nav>
      ) : null}
    </div>
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
      activeProps={{ className: "mobile-nav-active" }}
      className="mobile-nav-item"
      to={to}
    >
      {icon}
      {label}
    </Link>
  );
}

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopMenu } from "./route";

afterEach(() => cleanup());

describe("DesktopMenu", () => {
  it("shows navigation and logout in a dismissible hamburger menu", () => {
    const onNavigate = vi.fn();
    const onLogout = vi.fn();
    render(<DesktopMenu onLogout={onLogout} onNavigate={onNavigate} />);

    const trigger = screen.getByRole("button", { name: "데스크톱 메뉴" });
    expect(trigger.getAttribute("aria-haspopup")).toBeNull();
    expect(trigger.getAttribute("aria-controls")).toBe("desktop-menu-popover");
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "라이브러리" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "리마인더" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "설정" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    expect(onNavigate).toHaveBeenCalledWith("/settings");
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole("button", { name: "설정" })).toBeNull();

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "로그아웃" })).toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(onLogout).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "로그아웃" })).toBeNull();
  });
});

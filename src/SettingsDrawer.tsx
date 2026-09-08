"use client";

import { useEffect, useState } from "react";

export function SettingsDrawer({
  firmName,
  userName,
  canCustomize,
  platformRole,
  pathname,
}: {
  pathname: string;
  firmName: string;
  userName: string;
  canCustomize: boolean;
  platformRole: "user" | "super_admin";
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", close);
    document.body.classList.add("drawer-open");
    return () => {
      document.removeEventListener("keydown", close);
      document.body.classList.remove("drawer-open");
    };
  }, [open]);

  return (
    <>
      <button
        className="drawer-trigger"
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open injury.bot menu"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path
            d="M4 7h16M4 12h16M4 17h16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {open && (
        <button
          className="drawer-scrim"
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={open ? "settings-drawer open" : "settings-drawer"}
        aria-hidden={!open}
        inert={!open}
        aria-label="injury.bot menu"
      >
        <header>
          <div>
            <p className="eyebrow">{firmName}</p>
            <h2>Control center</h2>
            <p>Signed in as {userName}</p>
            {platformRole === "super_admin" && (
              <span className="super-badge">Super Admin</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            ×
          </button>
        </header>
        <nav aria-label="Features">
          <p className="drawer-label">Features</p>
          <a href="/">Command center</a>
          <a href="/coordinator">Talk to the coordinator</a>
          <a href="/atlas">Human Atlas</a>
          <a href="/cases">Cases</a>
          <a href="/injuries">Injury workspace</a>
          <a href="/evidence">Evidence</a>
          <a href="/exhibits">Exhibits</a>
          <a href="/agents">Agents</a>
        </nav>
        {canCustomize && (
          <nav aria-label="Customization">
            <p className="drawer-label">Customization</p>
            <a href="/settings#instructions">Instructions</a>
            <a href="/settings#memory">Memory</a>
            <a href="/settings#skills">Agent skills</a>
            <a href="/settings#models">Model choices</a>
            <a href="/settings#credentials">Provider credentials</a>
            <a href="/settings#integrations">Integrations</a>
          </nav>
        )}
        {canCustomize && (
          <a className="drawer-settings-link" href="/settings">
            Open all settings
          </a>
        )}
      </aside>
    </>
  );
}

"use client";

import { useState, type ReactElement } from "react";
import { THEME_COOKIE, type ThemeMode } from "@/lib/theme-mode";

const Sun = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
  </svg>
);
const Moon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z" />
  </svg>
);
const Auto = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5v17a8.5 8.5 0 0 0 0-17Z" fill="currentColor" stroke="none" />
  </svg>
);

const MODES: { mode: ThemeMode; label: string; Icon: () => ReactElement }[] = [
  { mode: "light", label: "Light", Icon: Sun },
  { mode: "dark", label: "Dark", Icon: Moon },
  { mode: "auto", label: "Auto: follow this device", Icon: Auto },
];

/**
 * Saves the mode and shows it at once: the cookie, so the server paints the right mode on the very first frame next
 * time, and data-theme on the page, which the CSS reads (none for Auto). The browser bar stays black in every mode.
 */
function applyMode(next: ThemeMode) {
  document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  const root = document.documentElement;
  if (next === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", next);
}

/** Light, Dark, or Auto (follow the phone or computer), applied without a reload. */
export function ThemeSwitch({ initial }: { initial: ThemeMode }) {
  const [mode, setMode] = useState<ThemeMode>(initial);

  const pick = (next: ThemeMode) => {
    setMode(next);
    applyMode(next);
  };

  return (
    <div role="radiogroup" aria-label="Colour mode" className="vr-seg">
      {MODES.map(({ mode: m, label, Icon }) => (
        <button key={m} type="button" role="radio" aria-checked={mode === m} aria-label={label} title={label} onClick={() => pick(m)} className="focus-ring">
          <Icon />
        </button>
      ))}
    </div>
  );
}

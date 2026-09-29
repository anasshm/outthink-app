import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Theme,
  Appearance,
  light,
  dark,
  useHostTheme,
  type ThemeMode,
} from "./theme";

const themeStorageKey = "outthink:theme";
const isThemeMode = (value: string | null): value is ThemeMode =>
  value === "light" || value === "dark";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemeMode | null>(() => {
    const preview = new URLSearchParams(window.location.search).get("theme");
    if (isThemeMode(preview)) return preview;
    try {
      const saved = window.localStorage.getItem(themeStorageKey);
      return isThemeMode(saved) ? saved : null;
    } catch {
      return null;
    }
  });
  const [isDark, setDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const mode = preference ?? (isDark ? "dark" : "light");
  const theme = mode === "dark" ? dark : light;
  const setMode = (next: ThemeMode) => {
    setPreference(next);
    try {
      window.localStorage.setItem(themeStorageKey, next);
    } catch {
      // The toggle still works when browser storage is unavailable.
    }
    const url = new URL(window.location.href);
    if (url.searchParams.has("theme")) {
      url.searchParams.set("theme", next);
      window.history.replaceState(window.history.state, "", url);
    }
  };
  useEffect(() => {
    document.body.style.background = theme.bg.editor;
    document.documentElement.style.colorScheme = mode;
    document.documentElement.style.setProperty(
      "--ot-negative",
      mode === "dark" ? "#ff8585" : "#c53939",
    );
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme.bg.editor);
  }, [theme, mode]);
  return (
    <Appearance.Provider value={{ mode, setMode }}>
      <Theme.Provider value={theme}>{children}</Theme.Provider>
    </Appearance.Provider>
  );
}
type ContentProps = { children?: ReactNode; style?: CSSProperties };
export function H1({ children, style }: ContentProps) {
  return (
    <h1
      style={{
        fontSize: 24,
        lineHeight: "30px",
        fontWeight: 590,
        margin: 0,
        ...style,
      }}
    >
      {children}
    </h1>
  );
}
export function Text({
  children,
  tone = "primary",
  size,
  style,
}: ContentProps & { tone?: keyof typeof light.text; size?: "small" }) {
  const theme = useHostTheme();
  return (
    <p
      style={{
        color: theme.text[tone],
        fontSize: size === "small" ? 12 : 14,
        margin: 0,
        ...style,
      }}
    >
      {children}
    </p>
  );
}
export function Button({
  children,
  onClick,
  disabled,
  style,
}: ContentProps & {
  onClick?: () => void;
  disabled?: boolean;
  variant?: string;
}) {
  const theme = useHostTheme();
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        border: `1px solid ${theme.stroke.secondary}`,
        borderRadius: 6,
        padding: "4px 12px",
        background: theme.bg.editor,
        color: theme.text.primary,
        opacity: disabled ? 0.45 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}
export function Row({
  children,
  gap,
  justify,
  align,
  wrap,
  style,
}: ContentProps & {
  gap?: number;
  justify?: CSSProperties["justifyContent"];
  align?: CSSProperties["alignItems"];
  wrap?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap,
        justifyContent: justify,
        alignItems: align,
        flexWrap: wrap ? "wrap" : "nowrap",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

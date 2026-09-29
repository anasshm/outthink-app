import { createContext, useContext } from "react";
export const light = {
  bg: { editor: "#ffffff", chrome: "#f8f9fa" },
  text: {
    primary: "#20252b",
    secondary: "#626a74",
    tertiary: "#747b83",
    onAccent: "#ffffff",
  },
  fill: { primary: "#dadddf", tertiary: "#f2f3f5" },
  stroke: { secondary: "#e1e4e8", focused: "#3374bd" },
  accent: { primary: "#3374bd" },
  category: {
    orange: "#c76d32",
    green: "#348b63",
    blue: "#3479b9",
    purple: "#8860b0",
  },
};
export const dark: typeof light = {
  bg: { editor: "#18191b", chrome: "#212225" },
  text: {
    primary: "#f0f0f0",
    secondary: "#b6b8bd",
    tertiary: "#92959d",
    onAccent: "#ffffff",
  },
  fill: { primary: "#484a50", tertiary: "#292b30" },
  stroke: { secondary: "#393b41", focused: "#91baff" },
  accent: { primary: "#91baff" },
  category: {
    orange: "#ec9c66",
    green: "#72bb99",
    blue: "#78a9df",
    purple: "#b19be0",
  },
};
export const Theme = createContext(light);
export const useHostTheme = () => useContext(Theme);
export type ThemeMode = "light" | "dark";
export const Appearance = createContext<{
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}>({ mode: "light", setMode: () => {} });
export const useAppearance = () => useContext(Appearance);

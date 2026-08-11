export function applyAppearance(theme: string | undefined, accent: string | undefined) {
  const root = document.documentElement;
  const shallow = matchMedia("(prefers-color-scheme: light)");
  const resolved = theme === "light" || (theme === "system" && shallow.matches) ? "light" : "dark";
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-accent", accent || "blue");
}
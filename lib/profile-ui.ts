import type { Profile, ProfileColor } from "./types";

export function profileFill(color: ProfileColor): string {
  return `var(--color-${color})`;
}

export function profileSoftFill(color: ProfileColor): string {
  return `var(--color-${color}-soft)`;
}

export function profileInitial(p: Profile): string {
  const name = p.name.trim();
  if (!name) return "?";
  const cp = name.codePointAt(0);
  return cp ? String.fromCodePoint(cp).toUpperCase() : "?";
}

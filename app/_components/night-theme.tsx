"use client";

import { useEffect } from "react";

// Eye-friendly night theme on a schedule: 20:00–07:59 local time gets the
// dimmed palette (see html[data-theme="night"] in globals.css). The initial
// paint is handled by an inline script in layout.tsx (no flash); this keeps it
// in sync while the app stays open across the 20h/08h boundaries.
function isNight(d = new Date()): boolean {
  const h = d.getHours();
  return h >= 20 || h < 8;
}

export function NightTheme() {
  useEffect(() => {
    function apply() {
      const root = document.documentElement;
      if (isNight()) root.setAttribute("data-theme", "night");
      else root.removeAttribute("data-theme");
    }
    apply();
    const id = setInterval(apply, 60_000);
    return () => clearInterval(id);
  }, []);
  return null;
}

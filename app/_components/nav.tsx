import Link from "next/link";

export type NavKey = "timeline" | "lembretes" | "diario" | "casa" | "ajustes";

const PRIMARY: { key: NavKey; label: string; href: string }[] = [
  { key: "timeline", label: "Timeline", href: "/" },
  { key: "lembretes", label: "Saúde", href: "/lembretes" },
  { key: "casa", label: "Dia a dia", href: "/casa" },
  { key: "diario", label: "Diário", href: "/diario" },
  { key: "ajustes", label: "Ajustes", href: "/settings" },
];

export function Nav({ current }: { current: NavKey }) {
  return (
    <nav className="flex justify-end">
      <div className="flex flex-wrap items-baseline justify-end gap-x-4 gap-y-1 text-[13px] sm:gap-x-5 sm:text-[14px]">
        {PRIMARY.map((it) => {
          const active = it.key === current;
          return (
            <Link
              key={it.key}
              href={it.href}
              className={
                "tracking-tight transition-colors " +
                (active ? "text-ink font-medium" : "text-ink-faint hover:text-ink-soft")
              }
            >
              {it.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

import Link from "next/link";

export type NavKey = "hoje" | "remedios" | "proximos" | "ajustes";

export function Nav({ current }: { current: NavKey }) {
  const items: { key: NavKey; label: string; href: string }[] = [
    { key: "hoje", label: "Hoje", href: "/" },
    { key: "remedios", label: "Remédios", href: "/medications" },
    { key: "proximos", label: "Próximos", href: "/upcoming" },
    { key: "ajustes", label: "Ajustes", href: "/settings" },
  ];
  return (
    <nav className="flex items-baseline gap-5 text-[14px] sm:gap-6 sm:text-[15px]">
      {items.map((it) => {
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
    </nav>
  );
}

import Link from "next/link";

export function Nav({ current }: { current: "hoje" | "remedios" | "ajustes" }) {
  const items: { key: typeof current; label: string; href: string }[] = [
    { key: "hoje", label: "Hoje", href: "/" },
    { key: "remedios", label: "Remédios", href: "/medications" },
    { key: "ajustes", label: "Ajustes", href: "/settings" },
  ];
  return (
    <nav className="flex items-baseline gap-6 text-[15px]">
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

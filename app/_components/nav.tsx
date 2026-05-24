import Link from "next/link";

export type NavKey =
  | "timeline"
  | "remedios"
  | "consultas"
  | "vacinas"
  | "diario"
  | "ajustes";

export function Nav({ current }: { current: NavKey }) {
  const items: { key: NavKey; label: string; href: string }[] = [
    { key: "timeline", label: "Timeline", href: "/" },
    { key: "remedios", label: "Medicamentos", href: "/medications" },
    { key: "consultas", label: "Consultas", href: "/appointments" },
    { key: "vacinas", label: "Vacinas", href: "/vaccines" },
    { key: "diario", label: "Diário", href: "/diario" },
    { key: "ajustes", label: "Ajustes", href: "/settings" },
  ];
  return (
    <nav className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13px] sm:gap-x-5 sm:text-[14px]">
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

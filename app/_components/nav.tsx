import Link from "next/link";

export type NavKey =
  | "timeline"
  | "remedios"
  | "consultas"
  | "vacinas"
  | "diario"
  | "ajustes";

type Group = "timeline" | "lembretes" | "diario" | "ajustes";

const GROUP_OF: Record<NavKey, Group> = {
  timeline: "timeline",
  remedios: "lembretes",
  consultas: "lembretes",
  vacinas: "lembretes",
  diario: "diario",
  ajustes: "ajustes",
};

const PRIMARY: { group: Group; label: string; href: string }[] = [
  { group: "timeline", label: "Timeline", href: "/" },
  { group: "lembretes", label: "Lembretes", href: "/medications" },
  { group: "diario", label: "Diário", href: "/diario" },
  { group: "ajustes", label: "Ajustes", href: "/settings" },
];

const LEMBRETES_SUB: { key: NavKey; label: string; href: string }[] = [
  { key: "remedios", label: "Medicamentos", href: "/medications" },
  { key: "consultas", label: "Consultas", href: "/appointments" },
  { key: "vacinas", label: "Vacinas", href: "/vaccines" },
];

export function Nav({ current }: { current: NavKey }) {
  const group = GROUP_OF[current];
  return (
    <nav className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-baseline justify-end gap-x-4 gap-y-1 text-[13px] sm:gap-x-5 sm:text-[14px]">
        {PRIMARY.map((it) => {
          const active = it.group === group;
          return (
            <Link
              key={it.group}
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
      {group === "lembretes" ? (
        <div className="flex flex-wrap items-baseline justify-end gap-x-3 gap-y-0.5 text-[12px] sm:text-[13px]">
          {LEMBRETES_SUB.map((it) => {
            const active = it.key === current;
            return (
              <Link
                key={it.key}
                href={it.href}
                className={
                  "tracking-tight transition-colors " +
                  (active ? "text-ink-soft font-medium" : "text-ink-faint hover:text-ink-soft")
                }
              >
                {it.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </nav>
  );
}

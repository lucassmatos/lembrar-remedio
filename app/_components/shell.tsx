import { Nav, type NavKey } from "./nav";

export function Shell({
  children,
  current,
  header,
}: {
  children: React.ReactNode;
  current: NavKey;
  header?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-[640px] flex-col px-5 pb-24 pt-8 sm:px-8 sm:pt-12">
      <header className="mb-10 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-full"
            style={{ background: "var(--color-clay)" }}
          />
          <span className="font-display text-[22px] leading-none tracking-tight text-ink">
            remédio
          </span>
        </div>
        <Nav current={current} />
      </header>
      {header}
      <main className="flex-1">{children}</main>
    </div>
  );
}

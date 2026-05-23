"use client";

import { useEffect, useState } from "react";
import { Shell } from "../_components/shell";
import { MedForm } from "../_components/med-form";
import { MedList } from "../_components/med-list";
import { PrescriptionScan } from "../_components/prescription-scan";
import { getMeds, onChange } from "@/lib/api";
import type { Medication } from "@/lib/types";

export default function MedicationsPage() {
  const [meds, setMeds] = useState<Medication[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const next = await getMeds();
        if (!cancelled) {
          setMeds(next);
          setMounted(true);
        }
      } catch {
        // ignore (middleware redirects)
      }
    }
    refresh();
    const off = onChange("meds", refresh);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return (
    <Shell
      current="remedios"
      header={
        <section className="mb-10">
          <p className="text-[13px] uppercase tracking-[0.18em] text-ink-faint">
            cadastro
          </p>
          <h1 className="mt-1 font-display text-[44px] leading-[1.05] tracking-tight text-ink">
            Remédios
          </h1>
        </section>
      }
    >
      {mounted ? <PrescriptionScan /> : null}

      <section className="mb-14">
        <h2 className="mb-4 font-display text-[18px] tracking-tight text-ink-soft">
          Novo remédio
        </h2>
        <MedForm />
      </section>

      {mounted ? (
        <section>
          <h2 className="mb-2 font-display text-[18px] tracking-tight text-ink-soft">
            {meds.length > 0 ? "Cadastrados" : ""}
          </h2>
          <MedList meds={meds} />
        </section>
      ) : null}
    </Shell>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Shell } from "../_components/shell";
import { MedForm } from "../_components/med-form";
import { MedList } from "../_components/med-list";
import { PrescriptionScan } from "../_components/prescription-scan";
import { loadMeds } from "@/lib/storage";
import type { Medication } from "@/lib/types";

export default function MedicationsPage() {
  const [meds, setMeds] = useState<Medication[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    function refresh() {
      setMeds(loadMeds());
      setMounted(true);
    }
    refresh();
    window.addEventListener("lr:change", refresh);
    return () => window.removeEventListener("lr:change", refresh);
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

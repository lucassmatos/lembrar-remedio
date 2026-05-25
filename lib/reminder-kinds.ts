import type { ReminderKind } from "./types";

export type ReminderKindMeta = {
  kind: ReminderKind;
  icon: string;
  noun: string;
  plural: string;
  newLabel: string;
  blurb?: string;
};

// Fonte única do que cada tipo de lembrete mostra na UI (seletor, timeline,
// listas). Adicionar um tipo novo = uma entrada aqui + um ramo no form da
// página Lembretes.
export const KIND_META: Record<ReminderKind, ReminderKindMeta> = {
  medication: {
    kind: "medication",
    icon: "💊",
    noun: "Medicamento",
    plural: "Medicamentos",
    newLabel: "Novo medicamento",
  },
  appointment: {
    kind: "appointment",
    icon: "📅",
    noun: "Consulta",
    plural: "Consultas",
    newLabel: "Nova consulta",
    blurb:
      "Cadastra a próxima consulta. Eu lembro de marcar com antecedência e de novo no dia anterior.",
  },
  vaccine: {
    kind: "vaccine",
    icon: "💉",
    noun: "Vacina",
    plural: "Vacinas",
    newLabel: "Nova vacina",
    blurb:
      "Cadastra a próxima dose. Eu lembro de marcar com antecedência e de novo perto da data.",
  },
};

export const KIND_ORDER: ReminderKind[] = ["medication", "appointment", "vaccine"];

export function isReminderKind(value: string | null | undefined): value is ReminderKind {
  return value === "medication" || value === "appointment" || value === "vaccine";
}

import type { Activity, BottleContent, FeedActivity, FeedMethod, FeedSide } from "./types";
import { feedMethod, isNap } from "./types";

/** Lado sugerido para a próxima mamada: alterna a partir da última. */
export function nextSide(last?: FeedSide): FeedSide {
  if (!last) return "left";
  return last === "left" ? "right" : "left";
}

/** Duração legível a partir de milissegundos. Ex.: "1h 15m", "45m", "1h". */
export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Rótulo do lado, minúsculo e canônico. Capitalize no ponto de uso se preciso. */
export const SIDE_LABEL: Record<FeedSide, string> = { left: "esquerdo", right: "direito" };

export const CONTENT_LABEL: Record<BottleContent, string> = {
  formula: "fórmula",
  breastmilk: "leite materno",
};
export const FEED_NOUN: Record<FeedMethod, string> = {
  breast: "Mamada",
  bottle: "Mamadeira",
  pump: "Extração",
};
export const FEED_ICON: Record<FeedMethod, string> = {
  breast: "🤱",
  bottle: "🍼",
  pump: "🥛",
};

/** O registro alimentou o bebê? Peito e mamadeira sim; extração (da mãe) não. */
export function isFeedToBaby(a: FeedActivity): boolean {
  return feedMethod(a) !== "pump";
}

/** Linha de detalhe da mamada para a lista. Ex.: "lado esquerdo", "120 ml · fórmula", "90 ml · lado direito". */
export function feedDetail(a: FeedActivity): string {
  const ml = a.amountMl != null ? `${a.amountMl} ml` : "";
  const side = a.side ? `lado ${SIDE_LABEL[a.side]}` : "";
  switch (feedMethod(a)) {
    case "breast":
      return side;
    case "bottle":
      return [ml, a.content ? CONTENT_LABEL[a.content] : ""].filter(Boolean).join(" · ");
    case "pump":
      return [ml, side].filter(Boolean).join(" · ");
  }
}

/** Instante do evento: início da soneca, ou hora da mamada. */
export function activityTime(a: Activity): number {
  return isNap(a) ? a.startedAt : a.at;
}

/** Hora local "HH:MM" de um timestamp no fuso do usuário. */
export function clock(ts: number, tz: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ts));
}

/**
 * Resumo do dia: "Xh Ym de sono · N mamadas · Z ml extraído".
 * Sonecas em andamento não contam tempo. Peito e mamadeira contam como mamada;
 * extração (leite tirado pela mãe) soma volume à parte, não é mamada do bebê.
 */
export function buildSummary(activities: Activity[]): string {
  let sleepMs = 0;
  let feeds = 0;
  let pumpedMl = 0;
  for (const a of activities) {
    if (isNap(a)) {
      if (a.endedAt != null) sleepMs += Math.max(0, a.endedAt - a.startedAt);
    } else if (isFeedToBaby(a)) {
      feeds += 1;
    } else {
      pumpedMl += a.amountMl ?? 0;
    }
  }
  const parts: string[] = [];
  if (sleepMs > 0) parts.push(`${formatDuration(sleepMs)} de sono`);
  parts.push(`${feeds} ${feeds === 1 ? "mamada" : "mamadas"}`);
  if (pumpedMl > 0) parts.push(`${pumpedMl} ml extraído`);
  return parts.join(" · ");
}

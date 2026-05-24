import { DEFAULT_OPENAI_MODEL } from "./storage";

export type ParsedMed = {
  name: string;
  dosage?: string;
  times: string[];
  intervalHours: number;
  startTime: string;
  durationDays?: number;
  notes?: string;
  confidence?: "high" | "medium" | "low";
};

export type ParsedPrescription = {
  medications: ParsedMed[];
  warnings?: string[];
};

const SYSTEM_PROMPT = `Você lê fotos de receitas médicas brasileiras e converte a posologia em horários concretos. Português do Brasil.

Para cada medicamento identificado retorne:
- name: nome do medicamento como aparece na receita (princípio ativo ou marca).
- dosage: quantidade por dose quando explícita ("1 comprimido", "20mg", "10 gotas", "1/2 comprimido").
- times: array de strings "HH:MM" com TODOS os horários do dia. Você decide horários concretos a partir das instruções verbais.
- intervalHours: intervalo médio em horas entre doses. Se 1x/dia use 24. Se times for não uniforme, use a melhor aproximação (ex.: 3x ao dia = 8).
- startTime: igual a times[0].
- durationDays: duração do tratamento em dias, quando a receita indicar.
- notes: trecho literal da receita que descreve quando tomar (ex.: "depois do café", "em jejum"). Curto.
- confidence: "high" quando a receita é explícita; "medium" quando inferiu horários a partir de termos vagos; "low" quando o campo está ilegível ou ambíguo.

Mapeamento de termos → horário (use como base; ajuste se a receita for mais específica):
- "em jejum" / "antes do café" → 07:00
- "ao acordar" / "pela manhã" / "de manhã" → 08:00
- "café da manhã" / "no café" → 08:00
- "depois do café" → 08:30
- "meio da manhã" → 10:00
- "almoço" / "no almoço" → 12:30
- "antes do almoço" → 12:00
- "depois do almoço" → 13:00
- "meio da tarde" / "à tarde" → 15:00
- "lanche da tarde" → 16:00
- "jantar" / "no jantar" → 19:30
- "antes do jantar" → 19:00
- "depois do jantar" → 20:00
- "à noite" / "de noite" → 21:00
- "antes de dormir" / "ao deitar" → 22:00

Mapeamento de frequência (escolha times[] e intervalHours juntos):
- "1x ao dia" / "uma vez ao dia" / "diariamente" → 1 horário (use o que a receita indicar; default 08:00). intervalHours: 24.
- "2x ao dia" / "12/12h" / "de 12 em 12 horas" → 2 horários. Se a receita disser "manhã e noite" use ["08:00","20:00"]. Se "café e antes de dormir" use ["08:00","22:00"]. intervalHours: 12.
- "3x ao dia" / "8/8h" / "de 8 em 8 horas" → 3 horários. Se vier ancorado em refeições ("café, almoço, jantar") use ["08:00","12:30","19:30"]. Se intervalo estrito use ["08:00","16:00","00:00"]. intervalHours: 8.
- "4x ao dia" / "6/6h" → 4 horários espaçados 6h. intervalHours: 6.
- "a cada N horas" → intervalHours: N, times espaçados N horas a partir do horário ancoragem (default 08:00 se não houver pista).
- "se necessário" / "se dor" → 1 horário às 08:00 e adicione warning explicando que é SOS.

Regras importantes:
- Sempre devolva times[] preenchido com ao menos um horário.
- Times no formato HH:MM 24h, dois dígitos em cada parte.
- Não invente medicamentos. Se não houver nenhum, retorne { "medications": [] }.
- Se a foto estiver ilegível ou cortar parte importante, adicione strings em "warnings" explicando.
- Não use markdown, prosa nem comentários. Apenas JSON válido.

Formato de retorno:
{
  "medications": [
    {
      "name": "...",
      "dosage": "...",
      "times": ["HH:MM", ...],
      "intervalHours": number,
      "startTime": "HH:MM",
      "durationDays": number,
      "notes": "...",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "warnings": ["..."]
}`;

export async function analyzePrescription(
  apiKey: string,
  imageDataUrl: string,
  model: string = DEFAULT_OPENAI_MODEL,
): Promise<ParsedPrescription> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Leia esta receita e devolva o JSON com a posologia de cada medicamento.",
            },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let detail = body.slice(0, 240);
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      if (parsed.error?.message) detail = parsed.error.message;
    } catch {
      // keep raw body
    }
    throw new Error(`OpenAI ${res.status}: ${detail || res.statusText}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Resposta vazia da OpenAI.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("A OpenAI não retornou JSON válido.");
  }

  const medsRaw = (parsed as { medications?: unknown }).medications;
  if (!Array.isArray(medsRaw)) return { medications: [] };

  const medications: ParsedMed[] = [];
  for (const m of medsRaw) {
    if (!m || typeof m !== "object") continue;
    const obj = m as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!name) continue;

    const rawTimes = Array.isArray(obj.times) ? obj.times : [];
    const times = rawTimes
      .filter((t): t is string => typeof t === "string")
      .map((t) => normalizeTime(t))
      .filter((t): t is string => !!t);

    const intervalRaw = Number(obj.intervalHours);
    const intervalFromTimes = inferInterval(times);
    const intervalHours =
      Number.isFinite(intervalRaw) && intervalRaw > 0
        ? intervalRaw
        : intervalFromTimes ?? 24;

    const startCandidate = typeof obj.startTime === "string" ? normalizeTime(obj.startTime) : null;
    const startTime = startCandidate ?? times[0] ?? "08:00";

    const effectiveTimes = times.length > 0 ? times : [startTime];

    const confidenceRaw = typeof obj.confidence === "string" ? obj.confidence.toLowerCase() : "";
    const confidence =
      confidenceRaw === "high" || confidenceRaw === "medium" || confidenceRaw === "low"
        ? (confidenceRaw as "high" | "medium" | "low")
        : undefined;

    medications.push({
      name,
      dosage: typeof obj.dosage === "string" && obj.dosage.trim() ? obj.dosage.trim() : undefined,
      times: effectiveTimes,
      intervalHours,
      startTime,
      durationDays:
        typeof obj.durationDays === "number" && obj.durationDays > 0 ? obj.durationDays : undefined,
      notes: typeof obj.notes === "string" && obj.notes.trim() ? obj.notes.trim() : undefined,
      confidence,
    });
  }

  const warningsRaw = (parsed as { warnings?: unknown }).warnings;
  const warnings = Array.isArray(warningsRaw)
    ? warningsRaw.filter((w): w is string => typeof w === "string" && w.trim().length > 0)
    : undefined;

  return { medications, warnings };
}

function normalizeTime(input: string): string | null {
  const trimmed = input.trim();
  const m = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function inferInterval(times: string[]): number | null {
  if (times.length < 2) return times.length === 1 ? 24 : null;
  const minutes = times.map((t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  });
  minutes.sort((a, b) => a - b);
  const diffs: number[] = [];
  for (let i = 1; i < minutes.length; i++) diffs.push(minutes[i] - minutes[i - 1]);
  const avg = diffs.reduce((s, n) => s + n, 0) / diffs.length;
  return Math.max(1, Math.round(avg / 60));
}

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Não consegui ler a imagem."));
    reader.readAsDataURL(file);
  });
}

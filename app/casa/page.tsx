"use client";

import { useEffect, useState } from "react";
import { Shell } from "../_components/shell";
import {
  addItem,
  createBirthday,
  createEvent,
  createList,
  createRoutine,
  deleteBirthday,
  deleteEvent,
  deleteItem,
  deleteList,
  deleteRoutine,
  getBirthdays,
  getEvents,
  getHouseLists,
  getListDetail,
  getRoutines,
  onChange,
  setItemDone,
  updateEvent,
  updateRoutine,
  type BirthdayInput,
  type BirthdayWithStatus,
  type EventInput,
  type EventWithStatus,
  type RoutineInput,
  type RoutineWithStatus,
} from "@/lib/api";
import { freqLabel } from "@/lib/routines";
import { ROUTINE_FREQS, type HouseList, type ListItem, type RoutineFreq } from "@/lib/types";
import { Cake, CalendarClock, Repeat } from "lucide-react";

export default function CasaPage() {
  const [lists, setLists] = useState<HouseList[]>([]);
  const [routines, setRoutines] = useState<RoutineWithStatus[]>([]);
  const [birthdays, setBirthdays] = useState<BirthdayWithStatus[]>([]);
  const [events, setEvents] = useState<EventWithStatus[]>([]);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState<HouseList | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const ls = await getHouseLists();
        if (cancelled) return;
        setLists(ls);
        setMounted(true);
        // Se a lista aberta sumiu (apagada noutro aparelho), volta pra raiz.
        setOpen((cur) => (cur && !ls.some((l) => l.id === cur.id) ? null : cur));
      } catch {
        // ignore
      }
    }
    refresh();
    const off = onChange("lists", refresh);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const rs = await getRoutines();
        if (!cancelled) setRoutines(rs);
      } catch {
        // ignore
      }
    }
    refresh();
    const off = onChange("routines", refresh);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const bs = await getBirthdays();
        if (!cancelled) setBirthdays(bs);
      } catch {
        // ignore
      }
    }
    refresh();
    const off = onChange("birthdays", refresh);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const es = await getEvents();
        if (!cancelled) setEvents(es);
      } catch {
        // ignore
      }
    }
    refresh();
    const off = onChange("events", refresh);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  // Sem h1 dedicado: a página é um stack de accordions (Listas, Rotinas,
  // Aniversários), cada um com seu serif h2 no header colapsável — um h1 "Casa"
  // no topo vira ruído. Kicker só, single source of truth.
  const header = (
    <section className="mb-8">
      <p className="text-[13px] uppercase tracking-[0.18em] text-ink-faint">casa</p>
    </section>
  );

  return (
    <Shell current="casa" header={header}>
      {!mounted ? null : open ? (
        <ListDetail list={open} onBack={() => setOpen(null)} />
      ) : (
        <div className="space-y-3">
          <Accordion title="Listas" count={lists.length}>
            <ListsView lists={lists} onOpen={setOpen} />
          </Accordion>
          <Accordion title="Rotinas" count={routines.length}>
            <RoutinesView routines={routines} setRoutines={setRoutines} />
          </Accordion>
          <Accordion title="Eventos" count={events.length}>
            <EventsView events={events} setEvents={setEvents} />
          </Accordion>
          <Accordion title="Aniversários" count={birthdays.length}>
            <BirthdaysView birthdays={birthdays} setBirthdays={setBirthdays} />
          </Accordion>
        </div>
      )}
    </Shell>
  );
}

/**
 * Seção colapsável da Casa. Colapsada por padrão — o usuário só expande o que
 * quer ver. O header (título + contagem + chevron) é o botão de toggle.
 */
function Accordion({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 border-b border-edge py-3 text-left transition-colors hover:opacity-80"
      >
        <h2 className="font-display text-[24px] leading-none tracking-tight text-ink">
          {title}
          {count > 0 ? (
            <span className="ml-2 align-middle text-[15px] text-ink-faint tabular-nums">
              {count}
            </span>
          ) : null}
        </h2>
        <svg
          width="18"
          height="18"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden
          className="shrink-0 text-ink-faint transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          <path
            d="M4 6 8 10l4-4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? <div className="pb-2 pt-4 enter">{children}</div> : null}
    </section>
  );
}

function ListsView({ lists, onOpen }: { lists: HouseList[]; onOpen: (l: HouseList) => void }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(e: React.SyntheticEvent) {
    e.preventDefault();
    if (busy || !title.trim()) return;
    setBusy(true);
    try {
      const created = await createList(title.trim());
      setTitle("");
      setAdding(false);
      onOpen(created);
    } catch {
      setBusy(false);
    }
  }

  return (
    <div>
      {!adding ? (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-full px-3.5 py-1.5 text-[13px] text-ink-soft transition-colors hover:text-ink"
            style={{ border: "1px dashed var(--color-edge-2)" }}
          >
            + nova lista
          </button>
        </div>
      ) : null}

      {adding ? (
        <form onSubmit={create} className="mb-4 flex items-center gap-2">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="nome da lista, Enter pra criar"
            maxLength={80}
            disabled={busy}
            className="min-w-0 flex-1 rounded-lg bg-transparent px-3 py-2 text-[16px] text-ink outline-none placeholder:text-ink-faint/60 focus:border-ink disabled:opacity-60"
            style={{ border: "1px solid var(--color-edge-2)" }}
          />
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setTitle("");
            }}
            className="shrink-0 text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-ink"
          >
            cancelar
          </button>
        </form>
      ) : null}

      {lists.length === 0 && !adding ? (
        <p className="py-6 text-[15px] text-ink-soft">
          Nenhuma lista ainda. Crie a primeira com “nova lista”.
        </p>
      ) : (
        <ul className="divide-y divide-edge">
          {lists.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => onOpen(l)}
                className="flex w-full items-center justify-between gap-4 py-4 text-left transition-colors hover:opacity-80"
              >
                <span className="min-w-0 truncate font-display text-[18px] tracking-tight text-ink">
                  {l.title}
                </span>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0 text-ink-faint">
                  <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ListDetail({ list, onBack }: { list: HouseList; onBack: () => void }) {
  const [items, setItems] = useState<ListItem[]>([]);
  const [text, setText] = useState("");
  const owner = list.ownerSub;

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const d = await getListDetail(owner, list.id);
        if (!cancelled) setItems(d.items);
      } catch {
        // ignore
      }
    }
    refresh();
    const off = onChange("lists", refresh);
    return () => {
      cancelled = true;
      off();
    };
  }, [owner, list.id]);

  // Atualizações otimistas com setState funcional: NUNCA `setItems(items.map(...))`,
  // sempre `setItems(curr => curr.map(...))`. A versão com closure pega snapshot
  // velho e dois cliques rápidos revertem o que o anterior fez.
  async function addLocal(e: React.SyntheticEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    const tempId = "tmp-" + Math.random().toString(36).slice(2, 10);
    const temp: ListItem = {
      id: tempId,
      listId: list.id,
      text: t,
      done: false,
      addedBy: "?",
      createdAt: Date.now(),
    };
    setItems((curr) => [...curr, temp]);
    setText("");
    try {
      const real = await addItem(owner, list.id, t);
      setItems((curr) => curr.map((i) => (i.id === tempId ? real : i)));
    } catch {
      setItems((curr) => curr.filter((i) => i.id !== tempId));
    }
  }

  async function toggle(item: ListItem) {
    const next = !item.done;
    setItems((curr) => curr.map((i) => (i.id === item.id ? { ...i, done: next } : i)));
    try {
      await setItemDone(owner, item.listId, item.id, next);
    } catch {
      setItems((curr) => curr.map((i) => (i.id === item.id ? { ...i, done: !next } : i)));
    }
  }

  async function remove(item: ListItem) {
    setItems((curr) => curr.filter((i) => i.id !== item.id));
    try {
      await deleteItem(owner, item.listId, item.id);
    } catch {
      // rollback: recoloca preservando ordem por createdAt
      setItems((curr) => [...curr, item].sort((a, b) => a.createdAt - b.createdAt));
    }
  }

  async function removeList() {
    if (!confirm(`Apagar a lista “${list.title}” e todos os itens?`)) return;
    await deleteList(owner, list.id);
    onBack();
  }

  return (
    <section>
      <div className="mb-4 border-b border-edge pb-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-[14px] text-ink-soft transition-colors hover:text-ink"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          listas
        </button>
      </div>

      <h2 className="mb-5 font-display text-[32px] leading-[1.1] tracking-tight text-ink">
        {list.title}
      </h2>

      <form onSubmit={addLocal} className="mb-5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="adicionar item, Enter pra criar"
          maxLength={200}
          className="w-full rounded-lg bg-transparent px-3 py-2 text-[16px] text-ink outline-none placeholder:text-ink-faint/60 focus:border-ink"
          style={{ border: "1px solid var(--color-edge-2)" }}
        />
      </form>

      {items.length === 0 ? (
        <p className="py-2 text-[15px] text-ink-soft">Lista vazia. Adicione o primeiro item.</p>
      ) : (
        <ul className="divide-y divide-edge">
          {items.map((it) => (
            <ItemRow key={it.id} item={it} onToggle={toggle} onRemove={remove} />
          ))}
        </ul>
      )}

      <div className="mt-10 border-t border-edge pt-4">
        <button
          type="button"
          onClick={removeList}
          className="text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 transition-colors hover:text-clay"
        >
          apagar lista
        </button>
      </div>
    </section>
  );
}

function RoutinesView({
  routines,
  setRoutines,
}: {
  routines: RoutineWithStatus[];
  setRoutines: React.Dispatch<React.SetStateAction<RoutineWithStatus[]>>;
}) {
  const [adding, setAdding] = useState(false);
  // Edição inline: id da rotina sendo editada (form pré-preenchido no lugar da linha).
  const [editingId, setEditingId] = useState<string | null>(null);

  async function remove(r: RoutineWithStatus) {
    if (!confirm(`Apagar a rotina “${r.title}”?`)) return;
    setEditingId((cur) => (cur === r.id ? null : cur));
    setRoutines((curr) => curr.filter((x) => x.id !== r.id));
    try {
      await deleteRoutine(r.ownerSub, r.id);
    } catch {
      setRoutines((curr) => [...curr, r].sort((a, b) => a.createdAt - b.createdAt));
    }
  }

  return (
    <div>
      {!adding ? (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-full px-3.5 py-1.5 text-[13px] text-ink-soft transition-colors hover:text-ink"
            style={{ border: "1px dashed var(--color-edge-2)" }}
          >
            + nova rotina
          </button>
        </div>
      ) : null}

      {adding ? <RoutineForm onDone={() => setAdding(false)} /> : null}

      {routines.length === 0 && !adding ? (
        <p className="py-2 text-[15px] text-ink-soft">
          Nenhuma rotina ainda. Recorrências do mês moram aqui (escola, salário, imposto…).
        </p>
      ) : (
        <ul className="divide-y divide-edge">
          {routines.map((r) =>
            editingId === r.id ? (
              <li key={r.id} className="py-3">
                <RoutineForm initial={r} onDone={() => setEditingId(null)} />
              </li>
            ) : (
              <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                {/* Recorrência não tem "check": marcar feito não faz sentido numa
                    coisa que repete todo mês. A linha edita; o feito do período
                    vive na Timeline. */}
                <button
                  type="button"
                  onClick={() => setEditingId(r.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <Repeat
                    size={18}
                    strokeWidth={1.75}
                    aria-hidden
                    className="shrink-0"
                    style={{ color: "var(--color-sand)" }}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-display text-[18px] tracking-tight text-ink">
                      {r.title}
                    </span>
                    <span className="block text-[13px] text-ink-soft">
                      {freqLabel(r)}
                      {r.time ? ` · ${r.time}` : ""}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => remove(r)}
                  className="shrink-0 text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 transition-colors hover:text-clay"
                >
                  apagar
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function RoutineForm({
  initial,
  onDone,
}: {
  initial?: RoutineWithStatus;
  onDone: () => void;
}) {
  const editing = initial != null;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [freq, setFreq] = useState<RoutineFreq>(initial?.freq ?? "monthly");
  const [anchor, setAnchor] = useState<number>(initial?.anchor ?? 1);
  const [time, setTime] = useState(initial?.time ?? "");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (busy || !title.trim()) return;
    setBusy(true);
    const input: RoutineInput = {
      title: title.trim(),
      freq,
      ...(freq !== "daily" ? { anchor } : {}),
      ...(time ? { time } : {}),
    };
    try {
      if (editing) await updateRoutine(initial!.ownerSub, initial!.id, input);
      else await createRoutine(input);
      onDone();
    } catch {
      setBusy(false);
    }
  }

  function changeFreq(next: RoutineFreq) {
    setFreq(next);
    if (next === "monthly") setAnchor(1);
    else if (next === "weekly") setAnchor(1);
    else setAnchor(0);
  }

  const inputCls =
    "w-full rounded-lg bg-transparent px-3 py-2 text-[16px] text-ink outline-none placeholder:text-ink-faint/60 focus:border-ink disabled:opacity-60";

  return (
    <form
      onSubmit={submit}
      className="mb-4 grid gap-5 rounded-2xl p-5"
      style={{ border: "1px solid var(--color-edge)", background: "var(--color-paper-2)" }}
    >
      <Field label="o que é">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="ex.: Pagar escola do Matheus"
          maxLength={80}
          disabled={busy}
          className={inputCls}
          style={{ border: "1px solid var(--color-edge-2)" }}
        />
      </Field>

      <Field label="frequência">
        <div
          className="grid grid-cols-3 gap-1.5 rounded-full p-1"
          style={{ border: "1px solid var(--color-edge-2)" }}
        >
          {ROUTINE_FREQS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={freq === f}
              onClick={() => changeFreq(f)}
              className={
                "rounded-full py-2 text-[14px] font-medium transition-colors " +
                (freq === f ? "text-paper" : "text-ink-soft hover:text-ink")
              }
              style={freq === f ? { background: "var(--color-ink)" } : undefined}
            >
              {f === "daily" ? "Diária" : f === "weekly" ? "Semanal" : "Mensal"}
            </button>
          ))}
        </div>
      </Field>

      {freq !== "daily" ? (
        <Field label={freq === "monthly" ? "dia do mês" : "dia da semana"}>
          {freq === "monthly" ? (
            <select
              value={anchor}
              onChange={(e) => setAnchor(Number(e.target.value))}
              className={"tnum " + inputCls}
              style={{ border: "1px solid var(--color-edge-2)" }}
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          ) : (
            <select
              value={anchor}
              onChange={(e) => setAnchor(Number(e.target.value))}
              className={inputCls}
              style={{ border: "1px solid var(--color-edge-2)" }}
            >
              <option value={1}>Segunda</option>
              <option value={2}>Terça</option>
              <option value={3}>Quarta</option>
              <option value={4}>Quinta</option>
              <option value={5}>Sexta</option>
              <option value={6}>Sábado</option>
              <option value={0}>Domingo</option>
            </select>
          )}
        </Field>
      ) : null}

      <Field label="horário (opcional)" hint={!time ? "vazio = aparece às 08:00 na timeline" : undefined}>
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className={"tnum " + inputCls}
          style={{ border: "1px solid var(--color-edge-2)" }}
        />
      </Field>

      <div className="flex items-center gap-3 pt-1 text-[14px]">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-ink px-5 py-2 text-[14px] font-medium text-paper hover:opacity-90 disabled:opacity-50"
        >
          {editing ? "salvar" : "criar"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-ink"
        >
          cancelar
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <p className="text-[12px] uppercase tracking-[0.16em] text-ink-faint">{label}</p>
      {children}
      {hint ? <p className="text-[12px] text-ink-faint">{hint}</p> : null}
    </div>
  );
}

const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function dateHint(b: BirthdayWithStatus): string {
  const dm = `${String(b.day).padStart(2, "0")}/${String(b.month).padStart(2, "0")}`;
  if (b.daysAway === 0) return `hoje! · ${dm}`;
  if (b.daysAway === 1) return `amanhã · ${dm}`;
  if (b.daysAway <= 30) return `em ${b.daysAway}d · ${dm}`;
  return dm;
}

/** Data local do navegador em YYYY-MM-DD (default do form de evento novo). */
function todayLocalISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function eventDateHint(e: EventWithStatus): string {
  const [, m, d] = e.date.split("-");
  const dm = `${d}/${m}`;
  const tail = e.time ? ` · ${e.time}` : "";
  if (e.daysAway === 0) return `hoje · ${dm}${tail}`;
  if (e.daysAway === 1) return `amanhã · ${dm}${tail}`;
  if (e.daysAway < 0) return `passou · ${dm}${tail}`;
  if (e.daysAway <= 60) return `em ${e.daysAway}d · ${dm}${tail}`;
  return `${dm}${tail}`;
}

function EventsView({
  events,
  setEvents,
}: {
  events: EventWithStatus[];
  setEvents: React.Dispatch<React.SetStateAction<EventWithStatus[]>>;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function remove(ev: EventWithStatus) {
    if (!confirm(`Apagar o evento “${ev.title}”?`)) return;
    setEditingId((cur) => (cur === ev.id ? null : cur));
    setEvents((curr) => curr.filter((x) => x.id !== ev.id));
    try {
      await deleteEvent(ev.ownerSub, ev.id);
    } catch {
      setEvents((curr) => [...curr, ev].sort((a, b) => a.daysAway - b.daysAway));
    }
  }

  return (
    <div>
      {!adding ? (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-full px-3.5 py-1.5 text-[13px] text-ink-soft transition-colors hover:text-ink"
            style={{ border: "1px dashed var(--color-edge-2)" }}
          >
            + novo evento
          </button>
        </div>
      ) : null}

      {adding ? <EventForm onDone={() => setAdding(false)} /> : null}

      {events.length === 0 && !adding ? (
        <p className="py-2 text-[15px] text-ink-soft">
          Nenhum evento ainda. Datas avulsas moram aqui (festa, reunião, viagem…).
        </p>
      ) : (
        <ul className="divide-y divide-edge">
          {events.map((ev) =>
            editingId === ev.id ? (
              <li key={ev.id} className="py-3">
                <EventForm initial={ev} onDone={() => setEditingId(null)} />
              </li>
            ) : (
              <li key={ev.id} className="flex items-center justify-between gap-3 py-3">
                <button
                  type="button"
                  onClick={() => setEditingId(ev.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <CalendarClock
                    size={18}
                    strokeWidth={1.75}
                    aria-hidden
                    className="shrink-0"
                    style={{ color: "var(--color-clay)" }}
                  />
                  <span className="min-w-0">
                    <span
                      className={
                        "block truncate font-display text-[18px] tracking-tight " +
                        (ev.daysAway < 0 ? "text-ink-faint" : "text-ink")
                      }
                    >
                      {ev.title}
                    </span>
                    <span
                      className={
                        "block text-[13px] " +
                        (ev.daysAway === 0 ? "font-medium text-amber" : "text-ink-soft")
                      }
                    >
                      {eventDateHint(ev)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => remove(ev)}
                  className="shrink-0 text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 transition-colors hover:text-clay"
                >
                  apagar
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function EventForm({
  initial,
  onDone,
}: {
  initial?: EventWithStatus;
  onDone: () => void;
}) {
  const editing = initial != null;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(initial?.date ?? todayLocalISO());
  const [time, setTime] = useState(initial?.time ?? "");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (busy || !title.trim() || !date) return;
    setBusy(true);
    const input: EventInput = {
      title: title.trim(),
      date,
      ...(time ? { time } : {}),
    };
    try {
      if (editing) await updateEvent(initial!.ownerSub, initial!.id, input);
      else await createEvent(input);
      onDone();
    } catch {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-lg bg-transparent px-3 py-2 text-[16px] text-ink outline-none placeholder:text-ink-faint/60 focus:border-ink disabled:opacity-60";

  return (
    <form
      onSubmit={submit}
      className="mb-4 grid gap-5 rounded-2xl p-5"
      style={{ border: "1px solid var(--color-edge)", background: "var(--color-paper-2)" }}
    >
      <Field label="o que é">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="ex.: Festa da Lia, reunião na escola"
          maxLength={80}
          disabled={busy}
          className={inputCls}
          style={{ border: "1px solid var(--color-edge-2)" }}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="dia">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={busy}
            className={"tnum " + inputCls}
            style={{ border: "1px solid var(--color-edge-2)" }}
          />
        </Field>
        <Field label="horário (opcional)">
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            disabled={busy}
            className={"tnum " + inputCls}
            style={{ border: "1px solid var(--color-edge-2)" }}
          />
        </Field>
      </div>

      <div className="flex items-center gap-3 pt-1 text-[14px]">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-ink px-5 py-2 text-[14px] font-medium text-paper hover:opacity-90 disabled:opacity-50"
        >
          {editing ? "salvar" : "criar"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-ink"
        >
          cancelar
        </button>
      </div>
    </form>
  );
}

function BirthdaysView({
  birthdays,
  setBirthdays,
}: {
  birthdays: BirthdayWithStatus[];
  setBirthdays: React.Dispatch<React.SetStateAction<BirthdayWithStatus[]>>;
}) {
  const [adding, setAdding] = useState(false);

  async function remove(b: BirthdayWithStatus) {
    if (!confirm(`Apagar o aniversário de "${b.name}"?`)) return;
    setBirthdays((curr) => curr.filter((x) => x.id !== b.id));
    try {
      await deleteBirthday(b.ownerSub, b.id);
    } catch {
      setBirthdays((curr) => [...curr, b].sort((a, b) => a.daysAway - b.daysAway));
    }
  }

  return (
    <div>
      {!adding ? (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-full px-3.5 py-1.5 text-[13px] text-ink-soft transition-colors hover:text-ink"
            style={{ border: "1px dashed var(--color-edge-2)" }}
          >
            + novo
          </button>
        </div>
      ) : null}

      {adding ? <NewBirthdayForm onDone={() => setAdding(false)} /> : null}

      {birthdays.length === 0 && !adding ? (
        <p className="py-2 text-[15px] text-ink-soft">
          Nenhum aniversário ainda. Coloca a família e a gente lembra.
        </p>
      ) : (
        <ul className="divide-y divide-edge">
          {birthdays.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Cake
                  size={18}
                  strokeWidth={1.75}
                  aria-hidden
                  style={{ color: "var(--color-violet)" }}
                />
                <span className="min-w-0">
                  <span className="block truncate font-display text-[18px] tracking-tight text-ink">
                    {b.name}
                  </span>
                  <span
                    className={
                      "block text-[13px] " +
                      (b.daysAway === 0 ? "font-medium text-amber" : "text-ink-soft")
                    }
                  >
                    {dateHint(b)}
                  </span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => remove(b)}
                className="shrink-0 text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 transition-colors hover:text-clay"
              >
                apagar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewBirthdayForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [day, setDay] = useState<number>(1);
  const [month, setMonth] = useState<number>(1);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    const input: BirthdayInput = { name: name.trim(), day, month };
    try {
      await createBirthday(input);
      onDone();
    } catch {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-lg bg-transparent px-3 py-2 text-[16px] text-ink outline-none placeholder:text-ink-faint/60 focus:border-ink disabled:opacity-60";

  return (
    <form
      onSubmit={submit}
      className="mb-4 grid gap-5 rounded-2xl p-5"
      style={{ border: "1px solid var(--color-edge)", background: "var(--color-paper-2)" }}
    >
      <Field label="quem">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ex.: Pri, Mãe, sobrinha Luísa"
          maxLength={80}
          disabled={busy}
          className={inputCls}
          style={{ border: "1px solid var(--color-edge-2)" }}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="dia">
          <select
            value={day}
            onChange={(e) => setDay(Number(e.target.value))}
            className={"tnum " + inputCls}
            style={{ border: "1px solid var(--color-edge-2)" }}
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        <Field label="mês">
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className={inputCls}
            style={{ border: "1px solid var(--color-edge-2)" }}
          >
            {MONTH_NAMES.map((n, i) => (
              <option key={i} value={i + 1}>
                {n}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex items-center gap-3 pt-1 text-[14px]">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-ink px-5 py-2 text-[14px] font-medium text-paper hover:opacity-90 disabled:opacity-50"
        >
          criar
        </button>
        <button
          type="button"
          onClick={onDone}
          className="text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-ink"
        >
          cancelar
        </button>
      </div>
    </form>
  );
}

function ItemRow({
  item,
  onToggle,
  onRemove,
}: {
  item: ListItem;
  onToggle: (i: ListItem) => void;
  onRemove: (i: ListItem) => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <button
        type="button"
        onClick={() => onToggle(item)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-pressed={item.done}
      >
        <span
          aria-hidden
          className="grid size-5 shrink-0 place-items-center rounded-full transition-colors"
          style={{
            border: "1.5px solid var(--color-edge-2)",
            background: item.done ? "var(--color-ink)" : "transparent",
            borderColor: item.done ? "var(--color-ink)" : "var(--color-edge-2)",
          }}
        >
          {item.done ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6.2 5 8.5l4.5-5" stroke="var(--color-paper)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : null}
        </span>
        <span
          className={
            "truncate text-[16px] " + (item.done ? "text-ink-faint line-through" : "text-ink")
          }
        >
          {item.text}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onRemove(item)}
        className="shrink-0 text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 transition-colors hover:text-clay"
      >
        apagar
      </button>
    </li>
  );
}

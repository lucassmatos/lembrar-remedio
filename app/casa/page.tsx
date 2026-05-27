"use client";

import { useEffect, useState } from "react";
import { Shell } from "../_components/shell";
import {
  addItem,
  createList,
  deleteItem,
  deleteList,
  getHouseLists,
  getListDetail,
  onChange,
  setItemDone,
} from "@/lib/api";
import type { HouseList, ListItem } from "@/lib/types";

export default function CasaPage() {
  const [lists, setLists] = useState<HouseList[]>([]);
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

  return (
    <Shell
      current="casa"
      header={
        <section className="mb-10">
          <p className="text-[13px] uppercase tracking-[0.18em] text-ink-faint">casa</p>
          <h1 className="mt-1 font-display text-[44px] leading-[1.05] tracking-tight text-ink">
            Recados
          </h1>
        </section>
      }
    >
      {!mounted ? null : open ? (
        <ListDetail list={open} onBack={() => setOpen(null)} />
      ) : (
        <ListsView lists={lists} onOpen={setOpen} />
      )}
    </Shell>
  );
}

function Dot() {
  return (
    <span
      aria-hidden
      className="size-2 shrink-0 rounded-full"
      style={{ background: "var(--color-sky)" }}
    />
  );
}

function ListsView({ lists, onOpen }: { lists: HouseList[]; onOpen: (l: HouseList) => void }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
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
    <section>
      <div className="mb-3 flex items-center justify-between gap-4 border-b border-edge pb-3">
        <h2 className="font-display text-[24px] leading-none tracking-tight text-ink">Listas</h2>
        {!adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-full px-3.5 py-1.5 text-[13px] text-ink-soft transition-colors hover:text-ink"
            style={{ border: "1px dashed var(--color-edge-2)" }}
          >
            + nova lista
          </button>
        ) : null}
      </div>

      {adding ? (
        <form onSubmit={create} className="mb-4 flex items-center gap-2">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="nome da lista (ex.: Compras)"
            maxLength={80}
            className="min-w-0 flex-1 rounded-lg bg-transparent px-3 py-2 text-[16px] text-ink outline-none placeholder:text-ink-faint/60 focus:border-ink"
            style={{ border: "1px solid var(--color-edge-2)" }}
          />
          <button
            type="submit"
            disabled={busy}
            className="shrink-0 rounded-full bg-ink px-4 py-2 text-[14px] font-medium text-paper hover:opacity-90 disabled:opacity-50"
          >
            criar
          </button>
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
                <span className="flex min-w-0 items-center gap-2.5">
                  <Dot />
                  <span className="truncate font-display text-[18px] tracking-tight text-ink">
                    {l.title}
                  </span>
                </span>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0 text-ink-faint">
                  <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ListDetail({ list, onBack }: { list: HouseList; onBack: () => void }) {
  const [items, setItems] = useState<ListItem[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
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

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true);
    try {
      await addItem(owner, list.id, text.trim());
      setText("");
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }

  async function removeList() {
    if (!confirm(`Apagar a lista “${list.title}” e todos os itens?`)) return;
    await deleteList(owner, list.id);
    onBack();
  }

  const pending = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-4 border-b border-edge pb-3">
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
        <button
          type="button"
          onClick={removeList}
          className="text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 transition-colors hover:text-clay"
        >
          apagar lista
        </button>
      </div>

      <h2 className="mb-4 font-display text-[24px] leading-none tracking-tight text-ink">
        {list.title}
      </h2>

      <form onSubmit={add} className="mb-5 flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="adicionar item"
          maxLength={200}
          className="min-w-0 flex-1 rounded-lg bg-transparent px-3 py-2 text-[16px] text-ink outline-none placeholder:text-ink-faint/60 focus:border-ink"
          style={{ border: "1px solid var(--color-edge-2)" }}
        />
        <button
          type="submit"
          disabled={busy}
          className="shrink-0 rounded-full bg-ink px-4 py-2 text-[14px] font-medium text-paper hover:opacity-90 disabled:opacity-50"
        >
          adicionar
        </button>
      </form>

      {items.length === 0 ? (
        <p className="py-2 text-[15px] text-ink-soft">Lista vazia. Adicione o primeiro item.</p>
      ) : (
        <ul className="divide-y divide-edge">
          {[...pending, ...done].map((it) => (
            <ItemRow key={it.id} item={it} ownerSub={owner} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ItemRow({ item, ownerSub }: { item: ListItem; ownerSub: string }) {
  async function toggle() {
    await setItemDone(ownerSub, item.listId, item.id, !item.done);
  }
  async function remove() {
    await deleteItem(ownerSub, item.listId, item.id);
  }
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <button
        type="button"
        onClick={toggle}
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
        onClick={remove}
        className="shrink-0 text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 transition-colors hover:text-clay"
      >
        apagar
      </button>
    </li>
  );
}

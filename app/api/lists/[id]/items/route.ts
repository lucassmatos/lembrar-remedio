import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { deleteListItem, getHouseList, getListItem, putListItem } from "@/lib/ddb";
import { mapAccessError, requireHouseholdAccess } from "@/lib/sharing";
import { requireSession } from "@/lib/session";
import type { ListItem } from "@/lib/types";
import { ID, ItemPatchSchema, ItemPostSchema, parseBody, SUB } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ownerFrom(req: NextRequest): string | null {
  const owner = new URL(req.url).searchParams.get("ownerSub");
  return owner && SUB.test(owner) ? owner : null;
}

// POST — adiciona item. Valida que a lista-pai existe (sem isso, listId inválido
// criaria item órfão na partição do owner).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const { id: listId } = await ctx.params;
  const ownerSub = ownerFrom(req);
  if (!ownerSub) return NextResponse.json({ error: "ownerSub obrigatório" }, { status: 400 });

  const parsed = await parseBody(req, ItemPostSchema);
  if (!parsed.ok) return parsed.response;

  try {
    await requireHouseholdAccess(s.sub, ownerSub);
  } catch (e) {
    return mapAccessError(e);
  }

  const parent = await getHouseList(ownerSub, listId);
  if (!parent) return NextResponse.json({ error: "list not found" }, { status: 404 });

  const item: ListItem = {
    id: nanoid(8),
    listId,
    text: parsed.data.text.trim(),
    done: false,
    addedBy: s.sub,
    createdAt: Date.now(),
  };
  await putListItem(ownerSub, item);
  return NextResponse.json({ item });
}

// PATCH — marca/desmarca item. done é SET (não toggle): dois cliques simultâneos
// convergem em vez de oscilar.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const { id: listId } = await ctx.params;
  const ownerSub = ownerFrom(req);
  if (!ownerSub) return NextResponse.json({ error: "ownerSub obrigatório" }, { status: 400 });

  const parsed = await parseBody(req, ItemPatchSchema);
  if (!parsed.ok) return parsed.response;

  try {
    await requireHouseholdAccess(s.sub, ownerSub);
  } catch (e) {
    return mapAccessError(e);
  }

  const existing = await getListItem(ownerSub, listId, parsed.data.itemId);
  if (!existing) return NextResponse.json({ error: "item not found" }, { status: 404 });

  const updated: ListItem = {
    ...existing,
    done: parsed.data.done,
    doneBy: parsed.data.done ? s.sub : undefined,
  };
  await putListItem(ownerSub, updated);
  return NextResponse.json({ item: updated });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const { id: listId } = await ctx.params;
  const ownerSub = ownerFrom(req);
  if (!ownerSub) return NextResponse.json({ error: "ownerSub obrigatório" }, { status: 400 });
  const itemId = new URL(req.url).searchParams.get("itemId");
  if (!itemId || !ID.test(itemId)) {
    return NextResponse.json({ error: "itemId inválido" }, { status: 400 });
  }

  try {
    await requireHouseholdAccess(s.sub, ownerSub);
  } catch (e) {
    return mapAccessError(e);
  }

  await deleteListItem(ownerSub, listId, itemId);
  return NextResponse.json({ ok: true });
}

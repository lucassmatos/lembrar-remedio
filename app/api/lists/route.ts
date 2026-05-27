import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { listsForHousehold, putHouseList } from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import type { HouseList } from "@/lib/types";
import { ListPostSchema, parseBody } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const lists = await listsForHousehold(s.sub);
  return NextResponse.json({ lists });
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const parsed = await parseBody(req, ListPostSchema);
  if (!parsed.ok) return parsed.response;

  const list: HouseList = {
    id: nanoid(8),
    ownerSub: s.sub,
    title: parsed.data.title.trim(),
    kind: parsed.data.kind ?? "custom",
    createdAt: Date.now(),
  };
  await putHouseList(s.sub, list);
  return NextResponse.json({ list });
}

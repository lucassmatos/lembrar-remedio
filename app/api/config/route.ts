import { NextRequest, NextResponse } from "next/server";
import { getConfig, setConfig } from "@/lib/ddb";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const cfg = await getConfig(s.sub);
  return NextResponse.json({ config: cfg });
}

export async function PATCH(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const body = await req.json();
  const cfg = await setConfig(s.sub, body);
  return NextResponse.json({ config: cfg });
}

import { NextRequest, NextResponse } from "next/server";
import { getConfig, setConfig } from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import { ConfigPatchSchema, parseBody } from "@/lib/validation";
import type { Config } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stripInternal(cfg: Config & { _registered?: boolean }): Config {
  const { _registered: _, ...clean } = cfg;
  void _;
  return clean;
}

export async function GET() {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const cfg = await getConfig(s.sub);
  return NextResponse.json({ config: stripInternal(cfg) });
}

export async function PATCH(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const parsed = await parseBody(req, ConfigPatchSchema);
  if (!parsed.ok) return parsed.response;
  // Only timezone can be set from the client. chatId is set by the Telegram
  // webhook after consuming a pair token — never accepted here.
  const cfg = await setConfig(s.sub, { timezone: parsed.data.timezone });
  return NextResponse.json({ config: stripInternal(cfg) });
}

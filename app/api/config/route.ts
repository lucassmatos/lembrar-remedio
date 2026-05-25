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
  // Only timezone + startScreen are client-settable. chatId is set by the
  // Telegram webhook after consuming a pair token — never accepted here.
  const patch: Partial<Config> = {};
  if (parsed.data.timezone !== undefined) patch.timezone = parsed.data.timezone;
  if (parsed.data.startScreen !== undefined) patch.startScreen = parsed.data.startScreen;
  const cfg = await setConfig(s.sub, patch);
  return NextResponse.json({ config: stripInternal(cfg) });
}

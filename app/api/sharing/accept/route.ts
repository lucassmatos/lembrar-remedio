import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { consumeGenericToken } from "@/lib/ddb";
import { acceptInvite } from "@/lib/sharing";
import { requireSession } from "@/lib/session";
import { parseBody } from "@/lib/validation";

export const runtime = "nodejs";

const AcceptSchema = z.object({ token: z.string().min(8).max(64) }).strict();

// Validate the invite payload decoded from the consumed token — a corrupt or
// malicious token must not slip past the self-invite / email checks.
const PayloadSchema = z
  .object({
    ownerSub: z.string().min(1),
    mode: z.enum(["partner", "caregiver"]),
    profileIds: z.array(z.string()).optional(),
    inviteeEmail: z.string().optional(),
  })
  .strip();

export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;

  const parsed = await parseBody(req, AcceptSchema);
  if (!parsed.ok) return parsed.response;

  const payloadJson = await consumeGenericToken(parsed.data.token);
  if (!payloadJson) {
    return NextResponse.json({ error: "convite inválido ou expirado" }, { status: 410 });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(payloadJson);
  } catch {
    return NextResponse.json({ error: "convite corrompido" }, { status: 400 });
  }

  const validated = PayloadSchema.safeParse(raw);
  if (!validated.success) {
    return NextResponse.json({ error: "convite corrompido" }, { status: 400 });
  }

  try {
    await acceptInvite({
      callerSub: s.sub,
      callerEmail: s.email,
      callerName: s.name,
      payload: validated.data,
    });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

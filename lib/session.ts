import { auth } from "@/auth";
import { NextResponse, type NextRequest } from "next/server";
import { ensureUser, getDeviceTokenOwner } from "./ddb";
import { DEV_USER_SUB, isDevLocal } from "./dev-store";

export async function requireSession(): Promise<
  | { ok: true; sub: string; email?: string | null; name?: string | null }
  | { ok: false; response: NextResponse }
> {
  if (isDevLocal()) {
    const email = "dev@local";
    const name = "Dev";
    await ensureUser(DEV_USER_SUB, { email, name });
    return { ok: true, sub: DEV_USER_SUB, email, name };
  }
  const session = await auth();
  const sub = session?.user?.id;
  if (!sub) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
    };
  }
  await ensureUser(sub, { email: session.user.email, name: session.user.name });
  return { ok: true, sub, email: session.user.email, name: session.user.name };
}

/**
 * Autentica o mostrador físico (e-paper) por TOKEN de device, sem sessão Google.
 * Aceita o token em `Authorization: Bearer <t>`, header `x-device-token`, ou
 * query `?token=` (este último só pra debug fácil com curl/navegador).
 */
export async function requireDeviceToken(
  req: NextRequest,
): Promise<{ ok: true; sub: string } | { ok: false; response: NextResponse }> {
  const hdr = req.headers.get("authorization");
  let token: string | null = null;
  if (hdr && hdr.toLowerCase().startsWith("bearer ")) token = hdr.slice(7).trim();
  if (!token) token = req.headers.get("x-device-token");
  // ?token= só em dev: token em URL vaza em log/referer (é credencial permanente).
  if (!token && isDevLocal()) token = new URL(req.url).searchParams.get("token");
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json({ error: "missing device token" }, { status: 401 }),
    };
  }
  const sub = await getDeviceTokenOwner(token);
  if (!sub) {
    return {
      ok: false,
      response: NextResponse.json({ error: "invalid device token" }, { status: 401 }),
    };
  }
  return { ok: true, sub };
}

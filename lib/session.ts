import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { ensureUser } from "./ddb";
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

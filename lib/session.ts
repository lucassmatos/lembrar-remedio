import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { ensureUser } from "./ddb";

export async function requireSession(): Promise<
  | { ok: true; sub: string; email?: string | null; name?: string | null }
  | { ok: false; response: NextResponse }
> {
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

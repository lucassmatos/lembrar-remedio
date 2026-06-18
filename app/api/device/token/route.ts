import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireSession } from "@/lib/session";
import { getConfig, setConfig, putDeviceToken, deleteDeviceToken } from "@/lib/ddb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: mostra o token atual do mostrador (ou null).
export async function GET() {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const cfg = await getConfig(s.sub);
  return NextResponse.json({ deviceToken: cfg.deviceToken ?? null });
}

// POST: cria (ou rotaciona) o token do mostrador e devolve. Rotacionar invalida
// o anterior — o device precisa ser reconfigurado com o novo.
export async function POST() {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const cfg = await getConfig(s.sub);
  const token = randomBytes(24).toString("base64url");
  // Ordem importa: grava o novo + aponta o config pra ele ANTES de apagar o
  // antigo. Se algo falhar no meio, o token antigo ainda é válido E referenciado
  // (em vez de o config apontar pra um token já apagado).
  await putDeviceToken(token, s.sub);
  await setConfig(s.sub, { deviceToken: token });
  if (cfg.deviceToken && cfg.deviceToken !== token) {
    try {
      await deleteDeviceToken(cfg.deviceToken);
    } catch {
      // best-effort: o novo já está ativo e referenciado
    }
  }
  return NextResponse.json({ deviceToken: token });
}

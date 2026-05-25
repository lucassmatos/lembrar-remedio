import type { PushSubscription } from "web-push";
import { VAPID_PUBLIC_KEY } from "./vapid-public";

// Web Push sender. Mirrors lib/telegram.ts: the private key comes from env on
// Vercel (VAPID_PRIVATE_KEY) or from Secrets Manager on the Lambda
// (VAPID_PRIVATE_KEY_SECRET_ARN). Lazy + cached so the SDK import stays out of
// the hot path on Vercel.

const SUBJECT = process.env.VAPID_SUBJECT || "https://lembrar-remedio.vercel.app";

let configured = false;
let configurePromise: Promise<void> | null = null;

async function ensureVapid(): Promise<void> {
  if (configured) return;
  if (!configurePromise) {
    configurePromise = (async () => {
      let priv = process.env.VAPID_PRIVATE_KEY;
      if (!priv) {
        const arn = process.env.VAPID_PRIVATE_KEY_SECRET_ARN;
        if (!arn) {
          throw new Error(
            "VAPID_PRIVATE_KEY não configurado (nem var direta nem VAPID_PRIVATE_KEY_SECRET_ARN)",
          );
        }
        const region = process.env.AWS_REGION || process.env.LR_AWS_REGION || "us-east-1";
        const { SecretsManagerClient, GetSecretValueCommand } = await import(
          "@aws-sdk/client-secrets-manager"
        );
        const client = new SecretsManagerClient({ region });
        const res = await client.send(new GetSecretValueCommand({ SecretId: arn }));
        priv = res.SecretString?.trim();
      }
      if (!priv) throw new Error("VAPID private key vazio");
      const webpush = (await import("web-push")).default;
      webpush.setVapidDetails(SUBJECT, VAPID_PUBLIC_KEY, priv);
      configured = true;
    })();
  }
  await configurePromise;
}

export type WebPushResult = { ok: true } | { ok: false; gone: boolean };

/**
 * Sends a Web Push notification. Returns ok:false with gone:true when the
 * subscription is dead (404/410) so the caller can prune it.
 */
export async function sendWebPush(
  subscription: PushSubscription,
  payload: Record<string, unknown>,
): Promise<WebPushResult> {
  await ensureVapid();
  const webpush = (await import("web-push")).default;
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { ok: true };
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    return { ok: false, gone: code === 404 || code === 410 };
  }
}

// Public VAPID key — safe to ship to clients (it's embedded in every push
// subscription anyway). The matching PRIVATE key lives in env (Vercel:
// VAPID_PRIVATE_KEY) / Secrets Manager (Lambda: VAPID_PRIVATE_KEY_SECRET_ARN)
// and is never committed. Client-safe module: no server deps, so it can be
// imported from the browser subscribe flow.
export const VAPID_PUBLIC_KEY =
  "BPhRse9rtpYAWLZPvRaHlMQPqk3uPJxaWqnP8QXzmHXeDtQo9VjGQ3LXBPnEHn_FBUG6y3eEQR3uUvyV3zD4PNU";

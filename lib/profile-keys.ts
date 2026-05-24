const SEP = " ";

function toBase64Url(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function fromBase64Url(s: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error("invalid base64url");
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const std = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(std, "base64").toString("utf8");
}

export function sanitizeMessageKey(slotKey: string, sub: string): string {
  return toBase64Url(`${slotKey}${SEP}${sub}`);
}

export function parseMessageKey(key: string): { slotKey: string; sub: string } {
  const decoded = fromBase64Url(key);
  const idx = decoded.indexOf(SEP);
  if (idx < 0) throw new Error("malformed message key");
  return { slotKey: decoded.slice(0, idx), sub: decoded.slice(idx + 1) };
}

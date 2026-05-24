// Build the /login redirect for an unauthenticated request. `from` must carry
// the full path AND query string: invite links like /casa/entrar?token=XXX lose
// the invitee's token if only the pathname survives the login round-trip.
export function buildLoginRedirect(nextUrl: URL): URL {
  const url = new URL("/login", nextUrl);
  if (nextUrl.pathname !== "/") {
    url.searchParams.set("from", nextUrl.pathname + nextUrl.search);
  }
  return url;
}

// Sanitize a `from` query param before using it as a post-login redirect target.
// Only same-origin relative paths pass: must start with a single "/" — never
// "//" (protocol-relative, resolves cross-origin) nor "/\" (some browsers
// normalize the backslash to "/" → also cross-origin). Anything else, including
// absolute URLs like https://evil.com, falls back to "/". Defense-in-depth: the
// open `/login?from=` surface stays closed even if a custom NextAuth redirect
// callback is added later.
export function safeFromParam(from: string | undefined | null): string {
  if (!from || !from.startsWith("/")) return "/";
  if (from.startsWith("//") || from.startsWith("/\\")) return "/";
  return from;
}

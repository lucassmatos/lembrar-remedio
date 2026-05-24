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

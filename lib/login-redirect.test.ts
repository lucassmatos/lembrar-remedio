import { describe, it, expect } from "vitest";
import { buildLoginRedirect } from "./login-redirect";

describe("buildLoginRedirect", () => {
  it("preserves the query string so invite tokens survive the login redirect", () => {
    const url = buildLoginRedirect(
      new URL("https://app.example.com/casa/entrar?token=abc123"),
    );
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("from")).toBe("/casa/entrar?token=abc123");
  });

  it("preserves the pathname when there is no query string", () => {
    const url = buildLoginRedirect(new URL("https://app.example.com/medications"));
    expect(url.searchParams.get("from")).toBe("/medications");
  });

  it("does not set from for the root path", () => {
    const url = buildLoginRedirect(new URL("https://app.example.com/"));
    expect(url.searchParams.has("from")).toBe(false);
  });
});

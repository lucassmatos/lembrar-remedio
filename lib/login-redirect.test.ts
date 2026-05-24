import { describe, it, expect } from "vitest";
import { buildLoginRedirect, safeFromParam } from "./login-redirect";

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

describe("safeFromParam", () => {
  it("keeps same-origin relative paths, including invite tokens", () => {
    expect(safeFromParam("/casa/entrar?token=abc123")).toBe("/casa/entrar?token=abc123");
    expect(safeFromParam("/medications")).toBe("/medications");
  });

  it("falls back to / for missing or empty input", () => {
    expect(safeFromParam(undefined)).toBe("/");
    expect(safeFromParam(null)).toBe("/");
    expect(safeFromParam("")).toBe("/");
  });

  it("rejects absolute and protocol-relative URLs (open-redirect defense)", () => {
    expect(safeFromParam("https://evil.com")).toBe("/");
    expect(safeFromParam("//evil.com")).toBe("/");
    expect(safeFromParam("/\\evil.com")).toBe("/");
    expect(safeFromParam("javascript:alert(1)")).toBe("/");
  });
});

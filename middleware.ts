import { auth } from "@/auth";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth",
  "/api/telegram/webhook",
  "/api/telegram/setup",
  "/api/cron",
  "/manifest.webmanifest",
  "/icon.svg",
  "/sw.js",
];

const DEV_LOCAL = process.env.LR_DEV_LOCAL === "1";

export default DEV_LOCAL
  ? function () {
      return NextResponse.next();
    }
  : auth((req) => {
      const { nextUrl } = req;
      const path = nextUrl.pathname;

      if (PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"))) {
        return NextResponse.next();
      }

      if (!req.auth) {
        const url = new URL("/login", nextUrl);
        if (path !== "/") url.searchParams.set("from", path);
        return NextResponse.redirect(url);
      }

      return NextResponse.next();
    });

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

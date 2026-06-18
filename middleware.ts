import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { buildLoginRedirect } from "@/lib/login-redirect";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth",
  "/api/telegram/webhook",
  "/api/telegram/setup",
  "/api/cron",
  // O mostrador autentica por token próprio (requireDeviceToken), não por sessão.
  "/api/device",
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
        return NextResponse.redirect(buildLoginRedirect(nextUrl));
      }

      return NextResponse.next();
    });

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

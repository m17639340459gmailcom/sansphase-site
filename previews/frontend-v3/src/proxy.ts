import { hasLocale } from "next-intl";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { localV3AdminOrigin, planLocalAdminEntry, planLocalReaderRequest } from "./lib/local-reader-bridge";
import { planLocalBookMediaRequest } from "./lib/local-book-preview";

const intl = createMiddleware(routing);
const referencePages = new Set(["skills", "learn"]);

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const [, first, second] = pathname.split("/");
  const locale = hasLocale(routing.locales, first) ? first : null;
  const section = locale ? second : first;
  const localRequest = {
    pathname,
    search: request.nextUrl.search || (request.nextUrl.href.endsWith("?") ? "?" : ""),
    method: request.method,
    headers: request.headers,
  };
  const localOrigin = process.env.SANSPHASE_V3_LOCAL_READER_ORIGIN;
  if (section === "admin-console") {
    const entry = planLocalAdminEntry(localRequest, localOrigin);
    const headers = { "Cache-Control": "private, no-store" };
    return entry ? NextResponse.redirect(entry, { headers }) : new NextResponse(null, { status: 404, headers });
  }
  if (section === "api") {
    const decision = planLocalBookMediaRequest(localRequest, localV3AdminOrigin(localOrigin)) ?? planLocalReaderRequest(localRequest, localOrigin);
    const headers = { "Cache-Control": "private, no-store" };
    if ("status" in decision) {
      return new NextResponse(null, { status: decision.status, headers });
    }
    return NextResponse.rewrite(decision.destination, { request: { headers: decision.headers }, headers });
  }
  if (section === "admin" || section === "resume" || pathname === "/contact/wechat-qr.jpg") {
    return new NextResponse(null, { status: 404 });
  }
  if (referencePages.has(section)) {
    const missing = request.nextUrl.clone();
    missing.pathname = `/${locale ?? routing.defaultLocale}/preview-page-not-found`;
    return NextResponse.rewrite(missing, { status: 404 });
  }
  return intl(request);
}

export const config = {
  matcher: [
    "/((?!api|_next|_vercel|.*\\..*).*)",
    "/api/:path*",
    "/admin/:path*",
    "/resume/:path*",
    "/contact/wechat-qr.jpg",
  ],
};

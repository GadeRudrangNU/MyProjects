import { NextResponse, type NextRequest } from "next/server";

/**
 * The browser only ever talks to this origin; requests for the API are forwarded here at runtime so session cookies
 * stay first-party and the API address can change without a rebuild.
 */
export function proxy(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_DEMO === "1") return NextResponse.next();
  const api = process.env.API_URL ?? "http://127.0.0.1:4000";
  return NextResponse.rewrite(new URL(req.nextUrl.pathname + req.nextUrl.search, api));
}

export const config = { matcher: ["/v1/:path*", "/api/auth/:path*", "/f/:path*"] };

import { NextResponse, type NextRequest } from "next/server";
import { businessById } from "@dental-bot/core";
import { BUSINESS_COOKIE } from "@/lib/business";

/** Pages that exist for every business; anywhere else could be a page or record the other business doesn't have. */
const SAFE_BACK = /^\/(console(\/(handovers|help|insights|conversations))?)?$/;

export function GET(req: NextRequest) {
  const to = req.nextUrl.searchParams.get("to") ?? "";
  const back = req.nextUrl.searchParams.get("back") ?? "/";
  // A relative Location, so the redirect stays on the public host behind Render's proxy.
  const res = new NextResponse(null, { status: 303, headers: { location: SAFE_BACK.test(back) ? back : "/" } });
  if (businessById(to)) {
    res.cookies.set(BUSINESS_COOKIE, to, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  }
  return res;
}

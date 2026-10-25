import { NextResponse, type NextRequest } from "next/server";

/** Basic auth for the console when CONSOLE_PASSWORD is set; open in local dev otherwise. */
export function proxy(req: NextRequest) {
  const password = process.env.CONSOLE_PASSWORD;
  if (!password) return NextResponse.next();
  const header = req.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = atob(encoded);
    if (decoded.slice(decoded.indexOf(":") + 1) === password) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "www-authenticate": 'Basic realm="dental-bot console"' },
  });
}

export const config = { matcher: ["/console/:path*"] };

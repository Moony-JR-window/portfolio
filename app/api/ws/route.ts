// NOTE: The actual WebSocket server is attached to the raw HTTP server
// in `server.ts` at the `/api/ws` path, because App Router route handlers
// cannot handle the `upgrade` event that WebSockets require.
//
// This file exists only so the route is visible in your app tree / for
// documentation. If a client hits this via normal HTTP (not a WS upgrade),
// return a helpful message instead of a confusing 404.

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error:
        "This endpoint only accepts WebSocket upgrade requests, handled in server.ts.",
    },
    { status: 400 }
  );
}
// app/api/logs/route.ts
// Read + clear the request log feed written by middleware.ts.
//
//   GET /api/logs          -> { ok, count, logs: RequestLogEntry[] } (newest first)
//   DELETE /api/logs       -> clears the buffer

import { NextResponse } from "next/server";

import { clearRequestLogs, getRequestLogs } from "@/lib/requestLog";

export const dynamic = "force-dynamic";

export async function GET() {
  const logs = getRequestLogs();
  return NextResponse.json({ ok: true, count: logs.length, logs });
}

export async function DELETE() {
  clearRequestLogs();
  const logs = getRequestLogs();
  return NextResponse.json({ ok: true, count: logs.length, logs });
}
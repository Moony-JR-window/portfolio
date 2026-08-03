import { NextResponse } from "next/server";
import { heartbeat, getOnlineCount } from "@/lib/online";

export async function POST(req: Request) {
  const { sessionId } = await req.json();

  if (!sessionId) {
    return NextResponse.json(
      { error: "Missing sessionId" },
      { status: 400 }
    );
  }

  heartbeat(sessionId);

  return NextResponse.json({
    online: getOnlineCount(),
  });
}
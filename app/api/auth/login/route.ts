import { NextResponse } from "next/server";
import { setSession } from "@/lib/auth";

export async function POST(req: Request) {
  const { username, password } = await req.json();
  if (username === process.env.DASHBOARD_USER && password === process.env.DASHBOARD_PASS) {
    await setSession();
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false }, { status: 401 });
}

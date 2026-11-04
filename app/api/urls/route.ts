import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getAll, add, remove } from "@/lib/urlStore";

export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "unauth" }, { status: 401 });
  return NextResponse.json(getAll());
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const { slug, originalUrl } = await req.json();
  try {
    const e = add(slug, originalUrl);
    return NextResponse.json(e);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const { id } = await req.json();
  remove(id);
  return NextResponse.json({ ok: true });
}

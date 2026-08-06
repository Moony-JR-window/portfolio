// app/api/network/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const headersList = await headers();

    // Get IP address from various proxy headers
    const forwardedFor = headersList.get("x-forwarded-for");
    const ip =
      forwardedFor?.split(",")[0]?.trim() ||
      headersList.get("x-real-ip") ||
      headersList.get("cf-connecting-ip") ||
      headersList.get("x-client-ip") ||
      "127.0.0.1";

    // Get host/domain
    const host = headersList.get("host") || "localhost:3000";
    const protocol = headersList.get("x-forwarded-proto") || "http";
    const domain = `${protocol}://${host}`;

    // Get user agent
    const userAgent = headersList.get("user-agent") || "Unknown";

    return NextResponse.json({
      ip,
      host,
      domain,
      protocol,
      userAgent,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Network info error:", error);
    return NextResponse.json(
      {
        ip: "127.0.0.1",
        host: "localhost:3000",
        domain: "http://localhost:3000",
        protocol: "http",
        userAgent: "Unknown",
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  }
}
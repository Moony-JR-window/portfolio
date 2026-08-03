// app/api/online/route.ts
import { NextResponse } from "next/server";
import { heartbeat, getOnlineCount } from "@/lib/online";
import { headers } from 'next/headers';

export async function POST(req: Request) {
  try {
    const { sessionId } = await req.json();
    
    if (!sessionId) {
      return NextResponse.json(
        { error: "Missing sessionId" },
        { status: 400 }
      );
    }
    // Get headers properly
    const headersList = await headers(); // Note: await is required in Next.js 15+
    
    // Get User Agent
    const userAgent = headersList.get('user-agent') || 'Unknown';
    
    // Get IP address (works with Vercel/Netlify/Cloudflare)
    const forwardedFor = headersList.get('x-forwarded-for');
    const ip = forwardedFor?.split(',')[0]?.trim() 
      || headersList.get('x-real-ip') 
      || headersList.get('cf-connecting-ip')
      || headersList.get('x-client-ip')
      || 'unknown-ip';

    console.log(`📥 Heartbeat from IP: ${ip}, User-Agent: ${userAgent}`);

    // Send heartbeat with IP and user agent
    const count = heartbeat(sessionId, ip, userAgent);

    return NextResponse.json({
      success: true,
      sessionId: sessionId,
      online: count,
      ip: ip,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Heartbeat error:', error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const count = getOnlineCount(true);
    const { getUsersDebug } = await import('@/lib/online');
    const users = getUsersDebug();
    
    return NextResponse.json({
      onlineCount: count,
      users: users,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting online count:', error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
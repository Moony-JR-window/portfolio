// app/api/online/route.ts
import { NextResponse } from "next/server";
import { heartbeat, getOnlineCount, getUsersDebug, markDeviceRegistered, getBrowserInfo } from "@/lib/online";
import { headers } from 'next/headers';
import axios from 'axios';

const DEVICE_API = "https://helpful-on-corgi.ngrok-free.app/api/v1/device";

async function registerDevice(sessionId: string, deviceName: string, userAgent: string) {
  try {
    const response = await axios.post(DEVICE_API, {
      deviceId: sessionId,
      deviceName: deviceName,
      UserNameAgent: userAgent
    }, {
      headers: {
        'accept': '*/*',
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ Device registered: ${sessionId}`, response.data);
    return response.data;
  } catch (error: any) {
    console.error(`❌ Failed to register device ${sessionId}:`, error?.response?.data || error.message);
    return null;
  }
}

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
    const headersList = await headers();
    
    // Get User Agent
    const userAgent = headersList.get('user-agent') || 'Unknown';
    
    // Get IP address
    const forwardedFor = headersList.get('x-forwarded-for');
    const ip = forwardedFor?.split(',')[0]?.trim() 
      || headersList.get('x-real-ip') 
      || headersList.get('cf-connecting-ip')
      || headersList.get('x-client-ip')
      || 'unknown-ip';

    console.log(`📥 Heartbeat from IP: ${ip}, User-Agent: ${userAgent}`);

    // Send heartbeat and check if new user
    const result = await heartbeat(sessionId, ip, userAgent);
    
    // Now result has proper typing
    const isNewUser = result.isNewUser;
    const count = result.count;
    const userKey = result.userKey;
    
    // If new user, register device with external API
    let deviceRegistration = null;
    if (isNewUser) {
      console.log(`🆕 New user detected, registering device...`);
      
      // Get browser info for device name
      const browserInfo = getBrowserInfo(userAgent);
      const deviceName = `${browserInfo.name} ${browserInfo.version}`;
      
      try {
        deviceRegistration = await registerDevice(sessionId, deviceName, userAgent);
        
        // Mark device as registered in our system
        markDeviceRegistered(userKey);
        
        console.log(`✅ Device registered successfully for ${sessionId}`);
      } catch (error) {
        console.error(`❌ Failed to register device for ${sessionId}`);
        // Continue even if device registration fails
      }
    }

    return NextResponse.json({
      success: true,
      sessionId: sessionId,
      online: count,
      ip: ip,
      isNewUser: isNewUser,
      deviceRegistered: deviceRegistration !== null,
      deviceRegistration: deviceRegistration,
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
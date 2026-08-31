import { getOnlineCount } from "@/lib/online";
import axios from "axios";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const VIEWER_API =
  "https://helpful-on-corgi.ngrok-free.app/api/v1/device/viewer";

const DECODE_API =
  "https://helpful-on-corgi.ngrok-free.app/api/v1/decode";

// Timeout for external API calls (5 seconds)
const API_TIMEOUT = 5000;

// In-memory cache for visit counts (refreshed every 30 seconds)
let cachedVisits = {
  total: 0,
  today: 0,
  timestamp: 0,
};
const CACHE_TTL = 30000; // 30 seconds

async function decodeViewerData(encoded: string) {
  const { data } = await axios.post(DECODE_API, {
    code:200,
    data: encoded,
  }, { timeout: API_TIMEOUT });

  return data;
}

// POST -> viewer -> decode -> return
export async function POST() {
  try {
    // 1. Get viewer data
    const viewerResponse = await axios.post(VIEWER_API, { timeout: API_TIMEOUT });

    const encoded = viewerResponse.data.data;

    // 2. Decode
    const decoded = await decodeViewerData(encoded);

    // 3. Return decoded response
    return NextResponse.json(decoded);

  } catch (error: any) {
    console.error(
      "Visit API POST error:",
      error?.response?.data || error.message
    );

    return NextResponse.json(
      {
        error: "Failed to process viewer data",
      },
      {
        status: 500,
      }
    );
  }
}

export async function GET() {
  const now = Date.now();

  // Return cached data if still fresh
  if (now - cachedVisits.timestamp < CACHE_TTL) {
    return NextResponse.json({
      total: cachedVisits.total,
      today: cachedVisits.today,
    });
  }

  try {
    // Get encrypted data
    const viewerResponse = await axios.post(VIEWER_API, { timeout: API_TIMEOUT });

    const encoded = viewerResponse.data.data.encrypt;

    // Decode
    const decoded = await decodeViewerData(encoded);

    const total = decoded.data.data;
    const today = getOnlineCount();

    // Update cache
    cachedVisits = { total, today, timestamp: now };

    return NextResponse.json({
      total,
      today,
    });

  } catch (error: any) {
    console.error(
      "Visit API GET error:",
      error?.response?.data || error.message
    );

    // Return cached data (even if stale) instead of 500 error
    if (cachedVisits.timestamp > 0) {
      return NextResponse.json({
        total: cachedVisits.total,
        today: cachedVisits.today,
      });
    }

    // Return fallback values when no cache available
    return NextResponse.json({
      total: 0,
      today: getOnlineCount(),
    });
  }
}

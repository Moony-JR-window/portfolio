import { getOnlineCount } from "@/lib/online";
import axios from "axios";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const VIEWER_API =
  "https://helpful-on-corgi.ngrok-free.app/api/v1/device/viewer";

const DECODE_API =
  "https://helpful-on-corgi.ngrok-free.app/api/v1/decode";


async function decodeViewerData(encoded: string) {
  const { data } = await axios.post(DECODE_API, {
    code:200,
    data: encoded,
  });

  return data;
}


// POST -> viewer -> decode -> return
export async function POST() {
  try {
    // 1. Get viewer data
    const viewerResponse = await axios.post(VIEWER_API);

    const encoded = viewerResponse.data.data;

    // 2. Decode
    const decoded = await decodeViewerData(encoded);

    // 3. Return decoded response
    return NextResponse.json(decoded);

  } catch (error: any) {
    console.error(
      "Visit API error:",
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
  try {
    // Get encrypted data
    const viewerResponse = await axios.post(VIEWER_API);

    const encoded = viewerResponse.data.data.encrypt;

    console.log("Encrypted:", encoded.substring(0, 50));

    // Decode
    const decoded = await decodeViewerData(encoded);

    console.log("Decoded:", decoded);

    return NextResponse.json({
    total: decoded.data.data,
    today: getOnlineCount()
});

  } catch (error: any) {
    console.error(
      "Visit API error:",
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
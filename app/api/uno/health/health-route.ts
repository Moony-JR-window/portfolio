/**
 * app/api/gemini/health/route.ts
 *
 * Static health check for the Gemini tunnel.
 * Next.js resolves this static segment BEFORE the [...path] catch-all,
 * so /api/gemini/health always answers locally and never hits Google.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    ok: true,
    upstream: "https://api.unorouter.com/v1",
    freeTier: {
      flash: "15 RPM / 1,500 RPD",
      pro: "2 RPM / 50 RPD",
      note: "Limits are per project, not per key. See https://api.unorouter.com/v1/docs/rate-limits",
    },
  });
}

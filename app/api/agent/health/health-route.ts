/**
 * app/api/agent/health/route.ts
 *
 * Static segment wins over the [...path] catch-all in Next.js, so this
 * answers GET /api/agent/health without touching NVIDIA at all.
 *
 * Use this if you want /api/agent/health to keep working exactly as before.
 * If you prefer ONE file only, skip this — the catch-all's healthz branch
 * already answers /api/agent/healthz locally.
 */

export const dynamic = "force-dynamic";

const UPSTREAM_BASE = "https://integrate.api.nvidia.com/v1";

export async function GET() {
  return Response.json({
    ok: true,
    upstream: UPSTREAM_BASE,
    tunnel: "/api/agent/v1/chat/completions",
    time: new Date().toISOString(),
  });
}

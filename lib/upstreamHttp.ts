// lib/upstreamHttp.ts
//
// Minimal Node HTTP client used by the /proxy relay for UPSTREAM requests.
// Next.js patches the global fetch (and undici resolution inside bundled
// routes is fragile), which breaks two things the relay needs:
//
//   • reading every Set-Cookie header (needed for the server-side cookie jar
//     that makes sign-in flows work — redirect "follow" also discards the
//     intermediate 30x hop entirely, losing the login cookies);
//   • manual redirect handling (so cookies from each hop are stored before
//     following).
//
// Using node:http/https directly gives us raw headers, no patching, and no
// surprise redirect behavior.

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage, RequestOptions } from "node:http";

export type UpstreamHeaders = Record<string, string | undefined>;

export type UpstreamResult = {
  status: number;
  statusText: string;
  /** All response headers, with duplicate names grouped into arrays. */
  headers: Record<string, string | string[] | undefined>;
  /** Exactly the wire order of header names (needed for Set-Cookie). */
  rawHeaders: string[];
  body: ArrayBuffer;
};

function performRequest(
  url: URL,
  method: string,
  headers: UpstreamHeaders,
  body: ArrayBuffer | undefined,
  timeoutMs: number
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? httpsRequest : httpRequest;
    const options: RequestOptions = {
      method,
      headers,
      timeout: timeoutMs,
      // Browsers send these; some sites (Google) return 403 without them.
      rejectUnauthorized: true,
      servername: url.hostname,
    };
    const req = lib(url, options, (res) => resolve(res));
    req.on("timeout", () => req.destroy(new Error(`Upstream timeout (${timeoutMs}ms)`)));
    req.on("error", (error) => reject(error));
    if (body && body.byteLength > 0) req.write(Buffer.from(body));
    req.end();
  });
}

/** Perform ONE upstream request (no redirect following). */
export async function singleUpstreamRequest(
  url: URL,
  method: string,
  headers: UpstreamHeaders,
  body: ArrayBuffer | undefined,
  timeoutMs = 15000
): Promise<UpstreamResult> {
  const res = await performRequest(url, method, headers, body, timeoutMs);

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () => resolve());
    res.on("error", (error) => reject(error));
  });

  const headersOut: Record<string, string | string[] | undefined> = {};
  for (const name of Object.keys(res.headers)) {
    const value = res.headers[name];
    if (value != null) headersOut[name] = value;
  }

  return {
    status: res.statusCode ?? 0,
    statusText: res.statusMessage || "",
    headers: headersOut,
    rawHeaders: res.rawHeaders,
    body: Buffer.concat(chunks).buffer as ArrayBuffer,
  };
}

/** Pull every Set-Cookie value from raw response headers. */
export function setCookiesFrom(rawHeaders: string[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i - 1]?.toLowerCase() === "set-cookie") out.push(rawHeaders[i]);
  }
  return out;
}
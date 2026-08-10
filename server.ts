import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";
import http from "http";
import fs from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import { chatStore } from "./lib/chat-store";
import type {
  ClientToServerEvent,
  ServerToClientEvent,
  Visitor,
  ChatMessage,
} from "./types/chat";

const PORT = Number(process.env.WS_PORT || 3001);

// ---------------------------------------------------------------------------
// File upload / download configuration
// ---------------------------------------------------------------------------
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const ALLOWED_EXTENSIONS = new Set([
  ".xlsx",
  ".xls",
  ".csv",
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
]);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // restricted endpoint: 10 MB
const MAX_BIG_FILE_SIZE = 500 * 1024 * 1024; // "any file" endpoint: 500 MB
const POST_ID_REGEX = /^[a-zA-Z0-9_-]{1,100}$/;

// Upload endpoint options.
// allowedExtensions === null means "accept any file type".
interface UploadOptions {
  routePrefix: string; // e.g. "/api/upload/"
  label: string;
  maxSize: number;
  allowedExtensions: Set<string> | null;
}

const DEFAULT_UPLOAD: UploadOptions = {
  routePrefix: "/api/upload/",
  label: "Upload (restricted)",
  maxSize: MAX_FILE_SIZE,
  allowedExtensions: ALLOWED_EXTENSIONS,
};

const BIG_UPLOAD: UploadOptions = {
  routePrefix: "/api/upload-any/",
  label: "Upload (any file, up to 500 MB)",
  maxSize: MAX_BIG_FILE_SIZE,
  allowedExtensions: null,
};

// ---------------------------------------------------------------------------
// Rate limiting: 30 requests per 30 seconds, keyed by client IP
// ---------------------------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 30_000; // 30 seconds
const RATE_LIMIT_MAX = 30; // max 30 requests per window
const requestLog = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (requestLog.get(ip) ?? []).filter((t) => t > cutoff);

  if (timestamps.length >= RATE_LIMIT_MAX) {
    return true;
  }

  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return false;
}

function clientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (Array.isArray(forwarded)) return forwarded[0] ?? "";
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "";
}

// Derive the public base URL from the request so the Swagger "servers" entry
// matches whatever host the API is deployed on (local, Netlify, Vercel, ...).
function baseUrl(req: http.IncomingMessage): string {
  const proto = req.headers["x-forwarded-proto"];
  const scheme =
    typeof proto === "string" && proto.startsWith("https") ? "https" : "http";
  const host = req.headers.host ?? `localhost:${PORT}`;
  return `${scheme}://${host}`;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function sendJson(
  res: http.ServerResponse,
  status: number,
  payload: Record<string, unknown>
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Minimal multipart/form-data parser (single "file" field)
// ---------------------------------------------------------------------------
interface ParsedFile {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  size: number;
}

function parseMultipartFile(
  contentType: string | undefined,
  body: Buffer,
  maxSize: number
): ParsedFile {
  if (!contentType || !contentType.startsWith("multipart/form-data")) {
    throw new Error("Request must be multipart/form-data");
  }

  const boundaryMatch = contentType.match(
    /boundary=(?:"([^"]+)"|([^;]+))/i
  );
  if (!boundaryMatch) throw new Error("Missing multipart boundary");

  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);

  // Split the body on every occurrence of the boundary delimiter.
  const parts: Buffer[] = [];
  let start = 0;
  let idx = body.indexOf(boundary);
  while (idx !== -1) {
    parts.push(body.subarray(start, idx));
    start = idx + boundary.length;
    idx = body.indexOf(boundary, start);
  }

  for (const part of parts) {
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) continue;

    const rawHeaders = part.subarray(0, headerEnd).toString("utf8");
    let data = part.subarray(headerEnd + 4);

    // Strip the trailing CRLF that precedes the boundary.
    if (
      data.length >= 2 &&
      data[data.length - 2] === 13 &&
      data[data.length - 1] === 10
    ) {
      data = data.subarray(0, data.length - 2);
    }

    const nameMatch = rawHeaders.match(/name="([^"]*)"/);
    if (!nameMatch) continue;
    if (nameMatch[1] !== "file") continue;

    const filenameMatch = rawHeaders.match(/filename="([^"]*)"/);
    const mimeMatch = rawHeaders.match(/content-type:\s*([^\r\n]+)/i);
    const filename = filenameMatch ? filenameMatch[1] : "";

    if (!filename) throw new Error("No file provided");
    if (data.length > maxSize) throw new Error("File too large");

    return {
      filename,
      mimeType: mimeMatch ? mimeMatch[1].trim() : "application/octet-stream",
      buffer: data,
      size: data.length,
    };
  }

  throw new Error("No file provided");
}

// ---------------------------------------------------------------------------
// API: POST /api/upload/:postId        (restricted types, max 10 MB)
// API: POST /api/upload-any/:postId    (any file type, max 500 MB)
// Stores exactly one file per post. If the post already has a file, the old
// one is deleted before the new one is saved (single file per post).
// ---------------------------------------------------------------------------
async function handleUpload(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  ip: string,
  opts: UploadOptions
): Promise<void> {
  if (isRateLimited(ip)) {
    sendJson(res, 429, {
      error: "Rate limit exceeded. Max 30 requests per 30 seconds.",
    });
    return;
  }

  const postId = decodeURIComponent(
    url.pathname.slice(opts.routePrefix.length)
  );
  if (!POST_ID_REGEX.test(postId)) {
    sendJson(res, 400, { error: "Invalid postId" });
    return;
  }

  try {
    const body = await readBody(req);
    const file = parseMultipartFile(
      req.headers["content-type"],
      body,
      opts.maxSize
    );

    const ext = path.extname(file.filename).toLowerCase();
    if (opts.allowedExtensions && !opts.allowedExtensions.has(ext)) {
      sendJson(res, 400, {
        error: `Unsupported file type: '${ext || "(none)"}'`,
      });
      return;
    }

    const dir = path.join(UPLOADS_DIR, postId);
    await fs.mkdir(dir, { recursive: true });

    // Single file per post: delete any existing file + metadata first.
    const existing = await fs.readdir(dir);
    await Promise.all(
      existing.map((f) => fs.unlink(path.join(dir, f)).catch(() => {}))
    );

    const storedName = `file${ext}`;
    await fs.writeFile(path.join(dir, storedName), file.buffer);

    const meta = {
      postId,
      originalName: file.filename,
      storedName,
      mimeType: file.mimeType,
      size: file.size,
      uploadedAt: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(dir, "meta.json"),
      JSON.stringify(meta, null, 2)
    );

    sendJson(res, 200, { message: "File uploaded successfully", meta });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    const status = message === "File too large" ? 413 : 400;
    sendJson(res, status, { error: message });
  }
}


// ---------------------------------------------------------------------------
// API: POST /api/download/:postId
// Downloads the stored file for a post (download via POST, as required).
// ---------------------------------------------------------------------------
async function handleDownload(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  ip: string
): Promise<void> {
  if (isRateLimited(ip)) {
    sendJson(res, 429, {
      error: "Rate limit exceeded. Max 30 requests per 30 seconds.",
    });
    return;
  }

  const postId = decodeURIComponent(
    url.pathname.slice("/api/download/".length)
  );
  if (!POST_ID_REGEX.test(postId)) {
    sendJson(res, 400, { error: "Invalid postId" });
    return;
  }

  const dir = path.join(UPLOADS_DIR, postId);
  const metaPath = path.join(dir, "meta.json");
  if (!existsSync(metaPath)) {
    sendJson(res, 404, { error: "File not found" });
    return;
  }

  try {
    const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    const filePath = path.join(dir, meta.storedName);
    if (!existsSync(filePath)) {
      sendJson(res, 404, { error: "File not found" });
      return;
    }

    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": meta.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(
        meta.originalName
      )}"`,
      "Content-Length": data.length,
    });
    res.end(data);
  } catch (err) {
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : "Download failed",
    });
  }
}

// ---------------------------------------------------------------------------
// API: GET /api/file-info/:postId
// Returns the stored file's name + id (postId) as JSON so it can be
// referenced before downloading via POST /api/download/:postId.
// ---------------------------------------------------------------------------
async function handleFileInfo(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  ip: string
): Promise<void> {
  if (isRateLimited(ip)) {
    sendJson(res, 429, {
      error: "Rate limit exceeded. Max 30 requests per 30 seconds.",
    });
    return;
  }

  const postId = decodeURIComponent(
    url.pathname.slice("/api/file-info/".length)
  );
  if (!POST_ID_REGEX.test(postId)) {
    sendJson(res, 400, { error: "Invalid postId" });
    return;
  }

  const metaPath = path.join(UPLOADS_DIR, postId, "meta.json");
  if (!existsSync(metaPath)) {
    sendJson(res, 404, { error: "File not found" });
    return;
  }

  try {
    const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    sendJson(res, 200, {
      postId: meta.postId,
      fileName: meta.originalName,
      storedName: meta.storedName,
      mimeType: meta.mimeType,
      size: meta.size,
      uploadedAt: meta.uploadedAt,
    });
  } catch (err) {
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : "Failed to read file info",
    });
  }
}

// ---------------------------------------------------------------------------
// API: GET /api/files
// Lists every post that has a stored file, returning each post id + file
// name as JSON (so callers can know which post ids exist before downloading).
// ---------------------------------------------------------------------------
async function handleListFiles(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _url: URL,
  ip: string
): Promise<void> {
  if (isRateLimited(ip)) {
    sendJson(res, 429, {
      error: "Rate limit exceeded. Max 30 requests per 30 seconds.",
    });
    return;
  }

  try {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(UPLOADS_DIR);
    } catch {
      entries = []; // uploads dir does not exist yet
    }

    const files: unknown[] = [];
    for (const entry of entries) {
      const dir = path.join(UPLOADS_DIR, entry);
      try {
        const stat = await fs.stat(dir);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }

      const metaPath = path.join(dir, "meta.json");
      if (!existsSync(metaPath)) continue;

      try {
        const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
        files.push({
          postId: meta.postId,
          fileName: meta.originalName,
          storedName: meta.storedName,
          mimeType: meta.mimeType,
          size: meta.size,
          uploadedAt: meta.uploadedAt,
        });
      } catch {
        // skip files without valid metadata
      }
    }

    sendJson(res, 200, { files });
  } catch (err) {
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : "Failed to list files",
    });
  }
}

// ---------------------------------------------------------------------------
// OpenAPI / Swagger documentation
// ---------------------------------------------------------------------------
const swaggerSpec: Record<string, unknown> = {
  openapi: "3.0.3",
  info: {
    title: "Portfolio Server — File Upload / Download API",
    version: "1.0.0",
    description:
      "Store a single file per post. Re-uploading to the same post deletes the previous file first. " +
      "All endpoints are rate limited per client IP to 30 requests per 30 seconds (HTTP 429 when exceeded).",
  },
  paths: {
    "/api/upload/{postId}": {
      post: {
        summary: "Upload a file to a post (restricted types, max 10 MB)",
        description:
          "Stores one file for the post. Allowed extensions: .xlsx, .xls, .csv, .pdf, .doc, .docx, .txt. " +
          "If the post already has a file it is deleted before the new one is saved.",
        parameters: [
          {
            name: "postId",
            in: "path",
            required: true,
            schema: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,100}$" },
            description: "Unique ID of the post (letters, digits, dash, underscore).",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  file: { type: "string", format: "binary", description: "The file to store." },
                },
                required: ["file"],
              },
            },
          },
        },
        responses: {
          "200": { description: "File uploaded (previous file replaced)." },
          "400": { description: "Invalid postId, no file, or unsupported extension." },
          "413": { description: "File too large (over 10 MB)." },
          "429": { description: "Rate limit exceeded (30 requests / 30 seconds)." },
        },
      },
    },
    "/api/upload-any/{postId}": {
      post: {
        summary: "Upload any file type to a post (max 500 MB)",
        description:
          "Stores one file for the post. Accepts ANY file type up to 500 MB. " +
          "If the post already has a file it is deleted before the new one is saved.",
        parameters: [
          {
            name: "postId",
            in: "path",
            required: true,
            schema: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,100}$" },
            description: "Unique ID of the post (letters, digits, dash, underscore).",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  file: { type: "string", format: "binary", description: "The file to store (any type, up to 500 MB)." },
                },
                required: ["file"],
              },
            },
          },
        },
        responses: {
          "200": { description: "File uploaded (previous file replaced)." },
          "400": { description: "Invalid postId or no file." },
          "413": { description: "File too large (over 500 MB)." },
          "429": { description: "Rate limit exceeded (30 requests / 30 seconds)." },
        },
      },
    },
    "/api/files": {
      get: {
        summary: "List post ids that have a stored file",
        description:
          "Returns a JSON array of all posts that currently have a stored file, " +
          "including each post's id (postId) and file name. Use /api/download/{postId} to fetch a file.",
        responses: {
          "200": {
            description: "Array of stored files.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    files: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          postId: { type: "string" },
                          fileName: { type: "string" },
                          storedName: { type: "string" },
                          mimeType: { type: "string" },
                          size: { type: "number" },
                          uploadedAt: { type: "string", format: "date-time" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "429": { description: "Rate limit exceeded (30 requests / 30 seconds)." },
        },
      },
    },
    "/api/file-info/{postId}": {
      get: {
        summary: "Get a post's file name and id as JSON",
        description:
          "Returns the stored file metadata (id + file name) for the post as JSON, " +
          "so the caller knows the name before downloading via POST /api/download/{postId}.",
        parameters: [
          {
            name: "postId",
            in: "path",
            required: true,
            schema: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,100}$" },
            description: "Unique ID of the post.",
          },
        ],
        responses: {
          "200": {
            description: "File metadata JSON.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    postId: { type: "string" },
                    fileName: { type: "string" },
                    storedName: { type: "string" },
                    mimeType: { type: "string" },
                    size: { type: "number" },
                    uploadedAt: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
          "400": { description: "Invalid postId." },
          "404": { description: "No file stored for this post." },
          "429": { description: "Rate limit exceeded (30 requests / 30 seconds)." },
        },
      },
    },
    "/api/download/{postId}": {
      post: {
        summary: "Download a post's file (POST method)",
        description:
          "Returns the stored file for the post as an attachment. The file is downloaded via a POST request.",
        parameters: [
          {
            name: "postId",
            in: "path",
            required: true,
            schema: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,100}$" },
            description: "Unique ID of the post.",
          },
        ],
        responses: {
          "200": {
            description: "The file bytes with Content-Disposition attachment.",
            content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
          },
          "400": { description: "Invalid postId." },
          "404": { description: "No file stored for this post." },
          "429": { description: "Rate limit exceeded (30 requests / 30 seconds)." },
        },
      },
    },
  },
};

function buildSwaggerSpec(serverBase: string): Record<string, unknown> {
  return { ...swaggerSpec, servers: [{ url: serverBase }] };
}

const docsHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Portfolio Server API Docs</title>
    <link rel="stylesheet"
      href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body style="margin: 0">
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
    <script>
      window.onload = function () {
        window.ui = SwaggerUIBundle({
          url: "/swagger.json",
          dom_id: "#swagger-ui",
          deepLinking: true,
          presets: [
            SwaggerUIBundle.presets.apis,
            SwaggerUIStandalonePreset,
          ],
          layout: "StandaloneLayout",
        });
      };
    </script>
  </body>
</html>`;

// ---------------------------------------------------------------------------
// Single HTTP server: serves the upload/download API + the WebSocket chat
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const host = req.headers.host ?? "localhost";
  let url: URL;
  try {
    url = new URL(req.url ?? "/", `http://${host}`);
  } catch {
    sendJson(res, 400, { error: "Bad request" });
    return;
  }

  const ip = clientIp(req);

  // Swagger / OpenAPI docs
  if (req.method === "GET" && url.pathname === "/swagger.json") {
    sendJson(res, 200, buildSwaggerSpec(baseUrl(req)));
    return;
  }
  if (req.method === "GET" && url.pathname === "/docs" || req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(docsHtml);
    return;
  }

  // File info (name + id) as JSON
  if (req.method === "GET" && url.pathname.startsWith("/api/file-info/")) {
    void handleFileInfo(req, res, url, ip);
    return;
  }

  // List all post ids that have a stored file
  if (req.method === "GET" && url.pathname === "/api/files") {
    void handleListFiles(req, res, url, ip);
    return;
  }

  // Upload APIs
  if (req.method === "POST" && url.pathname.startsWith(BIG_UPLOAD.routePrefix)) {
    void handleUpload(req, res, url, ip, BIG_UPLOAD);
    return;
  }
  if (req.method === "POST" && url.pathname.startsWith(DEFAULT_UPLOAD.routePrefix)) {
    void handleUpload(req, res, url, ip, DEFAULT_UPLOAD);
    return;
  }

  // Download API (via POST as required)
  if (req.method === "POST" && url.pathname.startsWith("/api/download/")) {
    void handleDownload(req, res, url, ip);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

// ---------------------------------------------------------------------------
// WebSocket (chat) server, attached to the same HTTP server
// ---------------------------------------------------------------------------
interface ClientConn {
  id: string;
  ws: WebSocket;
}

const clients = new Map<string, ClientConn>();

function send(ws: WebSocket, event: ServerToClientEvent) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

function broadcast(event: ServerToClientEvent, exceptId?: string) {
  for (const [id, client] of clients) {
    if (id === exceptId) continue;
    send(client.ws, event);
  }
}

const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`   Upload API:     POST http://localhost:${PORT}/api/upload/:postId`);
  console.log(`   Big Upload API: POST http://localhost:${PORT}/api/upload-any/:postId  (any type, up to 500 MB)`);
  console.log(`   Download API:   POST http://localhost:${PORT}/api/download/:postId`);
  console.log(`   File Info API:  GET  http://localhost:${PORT}/api/file-info/:postId`);
  console.log(`   List Files API: GET  http://localhost:${PORT}/api/files`);
  console.log(`   API Docs:       GET  http://localhost:${PORT}/docs`);
  console.log(`   OpenAPI JSON:   GET  http://localhost:${PORT}/swagger.json`);
  console.log(`   WebSocket:      ws://localhost:${PORT}`);
});


wss.on("connection", (ws, req) => {
  const id = randomUUID();

  clients.set(id, { id, ws });

  const visitor: Visitor = {
    id,
    nickname: chatStore.generateGuestNickname(),
    ip: req.socket.remoteAddress ?? "",
    browser: "Unknown",
    online: true,
    connectedAt: Date.now(),
    lastSeen: Date.now(),
  };

  chatStore.addVisitor(visitor);

  send(ws, {
    type: "init",
    you: visitor,
    visitors: chatStore.getAllVisitors(),
    messages: chatStore.getRecentMessages(),
  });

  ws.on("message", (raw) => {
    let event: ClientToServerEvent;

    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (event.type === "message") {
      const sender = chatStore.getVisitor(id);
      if (!sender) return;

      const message: ChatMessage = {
        id: randomUUID(),
        senderId: id,
        senderNickname: sender.nickname,
        text: event.text,
        timestamp: Date.now(),
        seenBy: [id],
        ...(event.file ? { file: event.file } : {}),
      };

      chatStore.addMessage(message);

      broadcast({
        type: "message",
        message,
      });
    }
  });

  ws.on("close", () => {
    clients.delete(id);
    chatStore.removeVisitor(id);
  });
});
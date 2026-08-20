/**
 * End-to-end test for the typing indicator WebSocket feature.
 * Starts the server, connects two clients, and verifies that a typing
 * event from one client is received by the other.
 *
 * Run with:  npx tsx scripts/test-typing.ts
 */
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import WebSocket from "ws";

const WS_PORT = 3099;
const WS_URL = `ws://localhost:${WS_PORT}`;

let server: ChildProcessWithoutNullStreams | null = null;
let clientA: WebSocket | null = null;
let clientB: WebSocket | null = null;

function log(label: string, msg: string) {
  console.log(`[${label}] ${msg}`);
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // 1. Start the standalone server
  log("test", `Starting server on port ${WS_PORT}...`);
  server = spawn("npx", ["tsx", "server.ts"], {
    env: { ...process.env, WS_PORT: String(WS_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stdout.on("data", (data) => process.stdout.write(`[server] ${data}`));
  server.stderr.on("data", (data) => process.stderr.write(`[server] ${data}`));

  await delay(1500); // wait for server to boot

  // 2. Connect two clients
  log("test", "Connecting client A...");
  clientA = new WebSocket(`${WS_URL}/api/ws`);

  log("test", "Connecting client B...");
  clientB = new WebSocket(`${WS_URL}/api/ws`);

  // 3. Wait for both clients to receive "init"
  const initA = new Promise<void>((res) => {
    clientA!.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "init") {
        log("clientA", `Init received — you are "${event.you.nickname}"`);
        res();
      }
    });
  });

  const initB = new Promise<void>((res) => {
    clientB!.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "init") {
        log("clientB", `Init received — you are "${event.you.nickname}"`);
        res();
      }
    });
  });

  await Promise.all([initA, initB]);
  log("test", "Both clients initialised.");

  // 4. Client A sends a typing event
  log("clientA", "Sending typing=true...");
  clientA.send(JSON.stringify({ type: "typing", isTyping: true }));

  // 5. Verify client B receives the typing event
  const typingReceived = new Promise<void>((res) => {
    clientB!.once("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "typing" && event.isTyping) {
        log("clientB", `Typing event received — "${event.nickname}" is typing!`);
        res();
      } else {
        log("clientB", `Unexpected event: ${event.type}`);
      }
    });
  });

  await typingReceived;
  log("test", "✅ Typing indicator works — client B saw client A typing");

  // 6. Client A sends typing=false
  log("clientA", "Sending typing=false...");
  clientA.send(JSON.stringify({ type: "typing", isTyping: false }));

  const typingStopped = new Promise<void>((res) => {
    clientB!.once("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "typing" && !event.isTyping) {
        log("clientB", `Typing stopped — "${event.nickname}" is no longer typing.`);
        res();
      }
    });
  });

  await typingStopped;
  log("test", "✅ Typing stop event works — client B saw client A stop typing");

  // Cleanup
  clientA.close();
  clientB.close();
  await delay(300);
  server.kill();
  log("test", "Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Test failed:", err);
  server?.kill();
  process.exit(1);
});
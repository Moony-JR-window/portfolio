/**
 * Client-side helper for the local-only real terminal.
 *
 * Detects whether the real shell API is available (local dev mode).
 * When deployed (Netlify), the API returns { local: false } and the
 * terminal falls back to the simulated virtual file system.
 */

let realShellAvailable: boolean | null = null;

export interface RealShellResult {
  local: boolean;
  output: string;
  cwd: string;
}

/** Check once whether the real shell is available (cached). */
export async function isRealShellAvailable(): Promise<boolean> {
  if (realShellAvailable !== null) return realShellAvailable;

  try {
    const res = await fetch('/api/terminal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'echo __REAL_SHELL_OK__' }),
    });
    const data: RealShellResult = await res.json();
    realShellAvailable = data.local === true;
  } catch {
    realShellAvailable = false;
  }

  return realShellAvailable;
}

/** Execute a real command via the local API. Returns the full result. */
export async function runRealCommand(command: string): Promise<RealShellResult> {
  try {
    const res = await fetch('/api/terminal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    return (await res.json()) as RealShellResult;
  } catch {
    return { local: false, output: '', cwd: '' };
  }
}
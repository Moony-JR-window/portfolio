import { cookies } from "next/headers";

const COOKIE = "dash_session";

export async function isAuthenticated(): Promise<boolean> {
  const c = (await cookies()).get(COOKIE)?.value;
  return c === process.env.DASHBOARD_PASS;
}

export async function setSession() {
  (await cookies()).set(COOKIE, process.env.DASHBOARD_PASS || "", { httpOnly: true, path: "/", maxAge: 3600, sameSite: "lax" });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

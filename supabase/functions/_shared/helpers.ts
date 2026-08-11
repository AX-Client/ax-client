// Shared helpers for the AX Edge Functions.
// Functions run on Deno and use the REST API with the service-role key
// (env vars SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are built in).

export const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
  });

export const cors = (): Response | null =>
  null;

export async function rest(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const res = await fetch(`${url}/rest/v1${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.text();
  return { status: res.status, data: data ? JSON.parse(data) : null };
}

export async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

export function isoNow(offsetSec: number): string {
  return new Date(Date.now() + offsetSec * 1000).toISOString();
}

export const SESSION_TTL_SEC = 900; // 15 min
export const REFRESH_TTL_SEC = 30 * 24 * 3600; // 30 days

/// Verifies the Authorization header against the admin secret configured via
/// `supabase secrets set AX_ADMIN_SECRET=...`. The secret never leaves the
/// Edge Function environment.
export function adminOk(req: Request): boolean {
  const secret = Deno.env.get("AX_ADMIN_SECRET") ?? "";
  if (!secret) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

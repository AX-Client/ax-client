// POST /cloud-sync  Authorization: Bearer <session_token>
// body: { xuid, rev, options }
// Upserts ax_cloud_profiles with last-write-wins on rev.
// Response: { uploaded: <number of option keys> }
import { json, rest, sha256hex } from "../_shared/helpers.ts";

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "access-control-allow-origin": "*" } });
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return json(401, { error: "missing session token" });

  const tokenHash = await sha256hex(token);
  const row = await rest(
    "GET",
    `/ax_sessions?select=xuid&token_hash=eq.${encodeURIComponent(tokenHash)}`,
  );
  const match = Array.isArray(row.data) && row.data.length > 0 ? row.data[0] : null;
  if (!match) return json(401, { error: "unknown session" });

  let body: { xuid?: unknown; rev?: unknown; options?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid body" });
  }
  if (String(body.xuid ?? "") !== match.xuid) return json(400, { error: "xuid mismatch" });
  const rev = Number(body.rev ?? 0);
  const options = body.options ?? {};

  // last-write-wins: only accept a rev newer than the stored one
  const existing = await rest(
    "GET",
    `/ax_cloud_profiles?select=rev&xuid=eq.${encodeURIComponent(match.xuid)}&profile_key=eq.default`,
  );
  if (Array.isArray(existing.data) && existing.data.length > 0) {
    const storedRev = Number(existing.data[0].rev ?? 0);
    if (rev <= storedRev) {
      return json(200, { uploaded: 0 });
    }
  }

  await rest(
    "POST",
    "/ax_cloud_profiles?on_conflict=xuid,profile_key",
    { xuid: match.xuid, profile_key: "default", payload: options, rev },
  );

  return json(200, { uploaded: Object.keys(options as object).length });
};

if (import.meta.main) {
  Deno.serve(handler);
}

// GET /cloud-restore  Authorization: Bearer <session_token>
// Returns the stored cloud profile: { rev, options } or 404 if none exists yet.
import { json, rest, sha256hex } from "../_shared/helpers.ts";

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "access-control-allow-origin": "*" } });
  }
  if (req.method !== "GET") return json(405, { error: "method not allowed" });

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

  const rows = await rest(
    "GET",
    `/ax_cloud_profiles?select=payload,rev&xuid=eq.${encodeURIComponent(match.xuid)}&profile_key=eq.default`,
  );
  const found = Array.isArray(rows.data) && rows.data.length > 0 ? rows.data[0] : null;
  if (!found) return json(404, { error: "no cloud backup" });

  return json(200, { rev: Number(found.rev ?? 0), options: found.payload });
};

if (import.meta.main) {
  Deno.serve(handler);
}
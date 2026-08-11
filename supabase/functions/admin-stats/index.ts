// GET /admin-stats  Authorization: Bearer <AX_ADMIN_SECRET>
// Response: user/online counts + list of recently active players.
import { json, rest, adminOk } from "../_shared/helpers.ts";

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "access-control-allow-origin": "*" } });
  }
  if (!adminOk(req)) return json(401, { error: "invalid admin secret" });

  const [usersRes, sessionsRes, newsRes] = await Promise.all([
    rest("GET", "/ax_users?select=xuid,tier,player_name,last_seen&limit=100000"),
    rest("GET", "/ax_sessions?select=xuid,expires_at&limit=100000"),
    rest("GET", "/ax_news?select=title&limit=1"),
  ]);

  const users = Array.isArray(usersRes.data) ? usersRes.data : [];
  const sessions = Array.isArray(sessionsRes.data) ? sessionsRes.data : [];
  const now = Date.now();

  const byXuid = new Map<string, Record<string, unknown>>();
  for (const u of users) byXuid.set(String(u.xuid), u);

  const active = new Set<string>();
  for (const s of sessions) {
    const exp = Date.parse(String(s.expires_at));
    if (!Number.isNaN(exp) && exp > now) active.add(String(s.xuid));
  }

  const onlineUsers = [...active].map((xuid) => {
    const u = byXuid.get(xuid);
    return { xuid, player_name: u?.player_name ?? null };
  }).sort((a, b) => String(a.player_name ?? "").localeCompare(String(b.player_name ?? "")));

  return json(200, {
    users_total: users.length,
    premium_count: users.filter((u) => u.tier === "premium").length,
    online_count: onlineUsers.length,
    online_users: onlineUsers,
    news_count: Array.isArray(newsRes.data) ? newsRes.data.length : 0,
    generated_at: new Date().toISOString(),
  });
};

if (import.meta.main) {
  Deno.serve(handler);
}

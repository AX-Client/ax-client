// POST /admin-news  Authorization: Bearer <AX_ADMIN_SECRET>
// body: { action: "post", title, body?, link? } | { action: "delete", id }
// GET /admin-news  -> full news list (for the admin UI)
import { json, rest, adminOk } from "../_shared/helpers.ts";

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "access-control-allow-origin": "*" } });
  }
  if (!adminOk(req)) return json(401, { error: "invalid admin secret" });

  if (req.method === "GET") {
    const rows = await rest("GET", "/ax_news?select=id,title,body,link,created_at&order=created_at.desc&limit=100");
    return json(200, Array.isArray(rows.data) ? rows.data : []);
  }
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  let action: string;
  try {
    const b = await req.json();
    action = String(b.action ?? "post");
    if (action === "post") {
      const title = String(b.title ?? "").trim().slice(0, 200);
      if (!title) return json(400, { error: "missing title" });
      await rest("POST", "/ax_news", {
        title,
        body: String(b.body ?? "").slice(0, 5000),
        link: String(b.link ?? "").trim().slice(0, 500),
      });
      return json(200, { ok: true });
    }
    if (action === "delete") {
      const id = String(b.id ?? "");
      if (!id) return json(400, { error: "missing id" });
      await rest("DELETE", `/ax_news?id=eq.${encodeURIComponent(id)}`);
      return json(200, { ok: true });
    }
    return json(400, { error: "unknown action" });
  } catch (e) {
    return json(500, { error: String(e) });
  }
};

if (import.meta.main) {
  Deno.serve(handler);
}

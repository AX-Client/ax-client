// GET /news-rss  (public, no auth - feeds the launcher's news page)
// RSS 2.0 feed generated from ax_news. The launcher parses item/title,
// item/link, item/description and item/pubDate.
import { rest } from "../_shared/helpers.ts";

const RFC822 = (d: Date): string =>
  d.toUTCString().replace("UTC", "GMT");

export const handler = async (req: Request): Promise<Response> => {
  if (req.method !== "GET" && req.method !== "OPTIONS") {
    return new Response("method not allowed", { status: 405 });
  }
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "access-control-allow-origin": "*" } });
  }

  const rows = await rest("GET", "/ax_news?select=title,body,link,created_at&order=created_at.desc&limit=8");

  const items = (Array.isArray(rows.data) ? rows.data : []).map((n) => {
    const date = new Date(String(n.created_at ?? ""));
    const title = String(n.title ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const body = String(n.body ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const link = String(n.link ?? "").replace(/&/g, "&amp;");
    return `    <item>
      <title>${title}</title>
      <link>${link}</link>
      <description>${body}</description>
      <pubDate>${RFC822(date)}</pubDate>
    </item>`;
  }).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>AX Client News</title>
    <link>https://ax-client.com</link>
    <description>Official AX Client news</description>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-cache",
    },
  });
};

if (import.meta.main) {
  Deno.serve(handler);
}

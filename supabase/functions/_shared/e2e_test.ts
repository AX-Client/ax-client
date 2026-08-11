// End-to-end test of the AX Edge Functions against an in-memory mock of the
// Supabase REST API. Run with:
//   deno test --allow-net --allow-env supabase/functions/_shared/e2e_test.ts
import { assert, assertEquals } from "jsr:@std/assert";

type UsersRow = { xuid: string; tier: string; expires_at?: string };
type SessionRow = { token_hash: string; refresh_token_hash: string; xuid: string; expires_at: string };
type CloudRow = { xuid: string; profile_key: string; payload: unknown; rev: number };

const users: UsersRow[] = [];
const sessions: SessionRow[] = [];
const cloud: CloudRow[] = [];

const parseQs = (search: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(search)) out[k] = v;
  return out;
};

const filterEq = <T extends Record<string, unknown>>(rows: T[], qs: Record<string, string>): T[] =>
  rows.filter((r) => {
    for (const [k, v] of Object.entries(qs)) {
      if (k.startsWith("select")) continue;
      if (!v.startsWith("eq.")) continue;
      const key = k.replace(/^[a-z_]+\./, "");
      const rv = key in r ? r[key] : (r as Record<string, unknown>).xuid;
      if (String(rv ?? "") !== v.slice(3)) return false;
    }
    return true;
  });

const mockSupabase = async (req: Request): Promise<Response> => {
  try {
    return await mockInner(req);
  } catch (e) {
    console.error("MOCK ERROR", req.method, req.url, e);
    return new Response(`Internal Server Error: ${String(e)}`, { status: 500 });
  }
};

const mockInner = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const qs = parseQs(url.search);
  const table = url.pathname.replace("/rest/v1/", "").split("?")[0];
  const body = req.method === "POST" || req.method === "PATCH" ? await req.json() : null;

  if (req.method === "GET") {
    if (table === "ax_users") return json200(filterEq(users as unknown as Record<string, unknown>[], qs));
    if (table === "ax_sessions") return json200(filterEq(sessions as unknown as Record<string, unknown>[], qs));
    if (table === "ax_cloud_profiles") return json200(filterEq(cloud as unknown as Record<string, unknown>[], qs));
  }
  if (req.method === "POST") {
    if (table === "ax_users") {
      const i = users.findIndex((u) => u.xuid === body.xuid);
      if (i >= 0) users[i] = { ...users[i], ...body };
      else users.push(body);
      return new Response("", { status: 201 });
    }
    if (table === "ax_sessions") {
      sessions.push(body);
      return new Response("", { status: 201 });
    }
    if (table === "ax_cloud_profiles") {
      const i = cloud.findIndex((c) => c.xuid === body.xuid && c.profile_key === body.profile_key);
      if (i >= 0) cloud[i] = { ...cloud[i], ...body };
      else cloud.push(body);
      return new Response("", { status: 201 });
    }
  }
  if (req.method === "DELETE") {
    if (table === "ax_sessions") {
      const h = qs["token_hash"]?.replace("eq.", "");
      const i = sessions.findIndex((s) => s.token_hash === h);
      if (i >= 0) sessions.splice(i, 1);
      return new Response(null, { status: 204 });
    }
  }
  return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
};

const json200 = (data: unknown) =>
  new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });

const { handler: identify } = await import("../auth-identify/index.ts");
const { handler: refresh } = await import("../auth-refresh/index.ts");
const { handler: premiumStatus } = await import("../premium-status/index.ts");
const { handler: cloudSync } = await import("../cloud-sync/index.ts");

const call = (handler: (req: Request) => Promise<Response>, req: Request): Promise<Response> => handler(req);

Deno.test("auth chain: identify -> status -> refresh -> cloud-sync", async () => {
  const server = Deno.serve({ port: 0, onListen: () => {} }, mockSupabase);
  const port = server.addr.port;
  Deno.env.set("SUPABASE_URL", `http://127.0.0.1:${port}`);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

  try {
    // 1. identify
    const idRes = await call(identify, new Request("http://x/auth-identify", {
      method: "POST",
      body: JSON.stringify({ xuid: "2535461012345678" }),
    }));
    assertEquals(idRes.status, 200);
    const idBody = await idRes.json();
    assert(idBody.session_token.length > 40, "session token issued");
    assert(idBody.refresh_token.length > 40, "refresh token issued");

    // 2. premium status -> free on first sight
    const freeRes = await call(premiumStatus, new Request("http://x/premium-status", {
      headers: { Authorization: `Bearer ${idBody.session_token}` },
    }));
    assertEquals(freeRes.status, 200);
    assertEquals((await freeRes.json()).tier, "free");

    // 3. operator sets premium (simulated webhook)
    users.find((u) => u.xuid === "2535461012345678")!.tier = "premium";
    users.find((u) => u.xuid === "2535461012345678")!.expires_at = new Date(Date.now() + 3600_000).toISOString();
    const premRes = await call(premiumStatus, new Request("http://x/premium-status", {
      headers: { Authorization: `Bearer ${idBody.session_token}` },
    }));
    assertEquals((await premRes.json()).tier, "premium");

    // 4. refresh rotates the session
    const refRes = await call(refresh, new Request("http://x/auth-refresh", {
      method: "POST",
      body: JSON.stringify({ xuid: "2535461012345678", refresh_token: idBody.refresh_token }),
    }));
    assertEquals(refRes.status, 200);
    const refBody = await refRes.json();
    assert(refBody.session_token !== idBody.session_token, "session token rotated");

    // old session is invalid after rotation
    const oldRes = await call(premiumStatus, new Request("http://x/premium-status", {
      headers: { Authorization: `Bearer ${idBody.session_token}` },
    }));
    assertEquals(oldRes.status, 401, "rotated session rejected");

    // 5. cloud sync upload
    const opts = { renderDistance: "8", soundCategory_master: "0.5" };
    const syncRes = await call(cloudSync, new Request("http://x/cloud-sync", {
      method: "POST",
      headers: { Authorization: `Bearer ${refBody.session_token}` },
      body: JSON.stringify({ xuid: "2535461012345678", rev: 100, options: opts }),
    }));
    assertEquals(syncRes.status, 200);
    assertEquals((await syncRes.json()).uploaded, 2);

    // 6. older rev is rejected (last-write-wins)
    const staleRes = await call(cloudSync, new Request("http://x/cloud-sync", {
      method: "POST",
      headers: { Authorization: `Bearer ${refBody.session_token}` },
      body: JSON.stringify({ xuid: "2535461012345678", rev: 50, options: { renderDistance: "2" } }),
    }));
    assertEquals((await staleRes.json()).uploaded, 0);

    // 7. unknown session rejected
    const badRes = await call(cloudSync, new Request("http://x/cloud-sync", {
      method: "POST",
      headers: { Authorization: "Bearer deadbeef" },
      body: JSON.stringify({ xuid: "2535461012345678", rev: 1, options: {} }),
    }));
    assertEquals(badRes.status, 401);
  } finally {
    await server.shutdown();
    Deno.env.delete("SUPABASE_URL");
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
});

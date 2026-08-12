// End-to-end test of the AX Edge Functions against an in-memory mock of the
// Supabase REST API. Run with:
//   deno test --allow-net --allow-env supabase/functions/_shared/e2e_test.ts
import { assert, assertEquals } from "jsr:@std/assert";

type UsersRow = { xuid: string; tier: string; expires_at?: string; email?: string; mc_uuid?: string };

type SessionRow = { token_hash: string; refresh_token_hash: string; xuid: string; expires_at: string };
type CloudRow = { xuid: string; profile_key: string; payload: unknown; rev: number };
type NewsRow = { id: string; title: string; body: string; link: string; created_at: string };
type TransferRow = {
  id: string; xuid: string; name: string; size: number; status: string;
  object_key: string; expires_at: string; device_ids: string[];
};

const users: UsersRow[] = [];
const sessions: SessionRow[] = [];
const cloud: CloudRow[] = [];
const news: NewsRow[] = [];
const transfers: TransferRow[] = [];
const storageObjects = new Set<string>();
let mockPort = 0;

const parseQs = (search: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(search)) out[k] = v;
  return out;
};

const filterEq = <T extends Record<string, unknown>>(rows: T[], qs: Record<string, string>): T[] =>
  rows.filter((r) => {
    for (const [k, v] of Object.entries(qs)) {
      if (k.startsWith("select")) continue;
      const key = k.replace(/^[a-z_]+\./, "");
      if (v.startsWith("cs.")) {
        const arr = r[key];
        const want = JSON.parse(v.slice(3));
        if (!Array.isArray(arr) || !arr.includes(want)) return false;
        continue;
      }
      if (v.startsWith("not.cs.")) {
        const arr = r[key];
        const want = JSON.parse(v.slice(7));
        if (Array.isArray(arr) && arr.includes(want)) return false;
        continue;
      }
      if (v.startsWith("gt.") || v.startsWith("lt.")) {
        const op = v.slice(0, 3);
        const want = Date.parse(v.slice(3));
        const got = Date.parse(String(r[key] ?? ""));
        if (Number.isNaN(want) || Number.isNaN(got)) continue;
        if (op === "gt." && !(got > want)) return false;
        if (op === "lt." && !(got < want)) return false;
        continue;
      }
      if (v.startsWith("in.")) {
        const inner = v.slice(3);
        const vals = inner.startsWith("[")
          ? JSON.parse(inner)
          : inner.slice(1, -1).split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
        if (!vals.includes(String(r[key] ?? ""))) return false;
        continue;
      }
      if (!v.startsWith("eq.")) continue;
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
  const path = url.pathname;
  const table = path.replace("/rest/v1/", "").split("?")[0];

  // storage API (world transfers)
  const upSign = path.match(/^\/storage\/v1\/object\/upload\/sign\/world-transfer\/(.+)$/);
  if (upSign) {
    return json200({ signedUrl: `http://127.0.0.1:${mockPort}/fake-upload/${upSign[1]}`, token: "mock-token" });
  }
  const dlSign = path.match(/^\/storage\/v1\/object\/sign\/world-transfer\/(.+)$/);
  if (dlSign) {
    return json200({ signedUrl: `http://127.0.0.1:${mockPort}/fake-download/${dlSign[1]}` });
  }
  const objDel = path.match(/^\/storage\/v1\/object\/world-transfer\/(.+)$/);
  if (objDel && req.method === "DELETE") {
    storageObjects.delete(objDel[1]);
    return json200({ message: "ok" });
  }
  if (path.startsWith("/fake-upload/") && req.method === "PUT") {
    storageObjects.add(path.slice("/fake-upload/".length));
    return new Response(JSON.stringify({ Key: path }), { status: 200 });
  }
  if (path.startsWith("/fake-download/") && req.method === "GET") {
    return new Response("FAKE-ZIP", { status: 200, headers: { "content-type": "application/octet-stream" } });
  }

  const body = req.method === "POST" || req.method === "PATCH" ? await req.json() : null;

  if (req.method === "GET") {
    if (table === "ax_users") return json200(filterEq(users as unknown as Record<string, unknown>[], qs));
    if (table === "ax_sessions") return json200(filterEq(sessions as unknown as Record<string, unknown>[], qs));
    if (table === "ax_cloud_profiles") return json200(filterEq(cloud as unknown as Record<string, unknown>[], qs));
    if (table === "ax_world_transfers") return json200(filterEq(transfers as unknown as Record<string, unknown>[], qs));
    if (table === "ax_news") {
      const rows = [...news].sort((a, b) => b.created_at.localeCompare(a.created_at));
      return json200(rows);
    }
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
    if (table === "ax_world_transfers") {
      const row: TransferRow = { id: crypto.randomUUID(), device_ids: [], ...body };
      transfers.push(row);
      return json200([{ id: row.id }]);
    }
    if (table === "ax_news") {
      news.push({ id: crypto.randomUUID(), ...body, created_at: new Date().toISOString() });
      return new Response("", { status: 201 });
    }
  }
  if (req.method === "PATCH") {
    if (table === "ax_users") {
      const x = qs["xuid"]?.replace("eq.", "") ?? qs["mc_uuid"]?.replace("eq.", "");
      const u = users.find((row) => row.xuid === x || row.mc_uuid === x);
      if (u) Object.assign(u, body);
      return new Response(null, { status: 204 });
    }
    if (table === "ax_world_transfers") {
      const id = qs["id"]?.replace("eq.", "");
      const t = transfers.find((row) => row.id === id);
      if (t) Object.assign(t, body);
      return new Response(null, { status: 204 });
    }
  }
  if (req.method === "DELETE") {
    if (table === "ax_sessions") {
      const h = qs["token_hash"]?.replace("eq.", "");
      const i = sessions.findIndex((s) => s.token_hash === h);
      if (i >= 0) sessions.splice(i, 1);
      return new Response(null, { status: 204 });
    }
    if (table === "ax_world_transfers") {
      const id = qs["id"]?.replace("eq.", "");
      const i = transfers.findIndex((t) => t.id === id);
      if (i >= 0) transfers.splice(i, 1);
      return new Response(null, { status: 204 });
    }
    if (table === "ax_news") {
      const id = qs["id"]?.replace("eq.", "");
      const i = news.findIndex((n) => n.id === id);
      if (i >= 0) news.splice(i, 1);
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
const { handler: cloudRestore } = await import("../cloud-restore/index.ts");
const { handler: worldTransfer } = await import("../world-transfer/index.ts");

const call = (handler: (req: Request) => Promise<Response>, req: Request): Promise<Response> => handler(req);

const boot = async () => {
  const server = Deno.serve({ port: 0, onListen: () => {} }, mockSupabase);
  mockPort = server.addr.port;
  Deno.env.set("SUPABASE_URL", `http://127.0.0.1:${mockPort}`);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  return server;
};

Deno.test("auth chain: identify -> status -> refresh -> cloud-sync", async () => {
  const server = await boot();

  try {
    // 1. identify
    const idRes = await call(identify, new Request("http://x/auth-identify", {
      method: "POST",
      body: JSON.stringify({ xuid: "9e2601d1b5a040ec9fc5ef164f3c6046" }),
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
    users.find((u) => u.xuid === "9e2601d1b5a040ec9fc5ef164f3c6046")!.tier = "premium";
    users.find((u) => u.xuid === "9e2601d1b5a040ec9fc5ef164f3c6046")!.expires_at = new Date(Date.now() + 3600_000).toISOString();
    const premRes = await call(premiumStatus, new Request("http://x/premium-status", {
      headers: { Authorization: `Bearer ${idBody.session_token}` },
    }));
    assertEquals((await premRes.json()).tier, "premium");

    // 4. refresh rotates the session
    const refRes = await call(refresh, new Request("http://x/auth-refresh", {
      method: "POST",
      body: JSON.stringify({ xuid: "9e2601d1b5a040ec9fc5ef164f3c6046", refresh_token: idBody.refresh_token }),
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
      body: JSON.stringify({ xuid: "9e2601d1b5a040ec9fc5ef164f3c6046", rev: 100, options: opts }),
    }));
    assertEquals(syncRes.status, 200);
    assertEquals((await syncRes.json()).uploaded, 2);

    // 6. older rev is rejected (last-write-wins)
    const staleRes = await call(cloudSync, new Request("http://x/cloud-sync", {
      method: "POST",
      headers: { Authorization: `Bearer ${refBody.session_token}` },
      body: JSON.stringify({ xuid: "9e2601d1b5a040ec9fc5ef164f3c6046", rev: 50, options: { renderDistance: "2" } }),
    }));
    assertEquals((await staleRes.json()).uploaded, 0);

    // 7. cloud restore returns the stored profile
    const restRes = await call(cloudRestore, new Request("http://x/cloud-restore", {
      headers: { Authorization: `Bearer ${refBody.session_token}` },
    }));
    assertEquals(restRes.status, 200);
    const restBody = await restRes.json();
    assertEquals(restBody.rev, 100);
    assertEquals(restBody.options, opts);

    // 7. unknown session rejected
    const badRes = await call(cloudSync, new Request("http://x/cloud-sync", {
      method: "POST",
      headers: { Authorization: "Bearer deadbeef" },
      body: JSON.stringify({ xuid: "9e2601d1b5a040ec9fc5ef164f3c6046", rev: 1, options: {} }),
    }));
    assertEquals(badRes.status, 401);
  } finally {
    await server.shutdown();
    Deno.env.delete("SUPABASE_URL");
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
});

const { handler: adminStats } = await import("../admin-stats/index.ts");
const { handler: adminGrant } = await import("../admin-grant/index.ts");
const { handler: adminNews } = await import("../admin-news/index.ts");
const { handler: newsRss } = await import("../news-rss/index.ts");

const ADMIN = "supersecret";

Deno.test("admin: stats, grant, news + rss", async () => {
  const server = await boot();
  Deno.env.set("AX_ADMIN_SECRET", ADMIN);

  try {
    // identify a user with a name (fresh session -> online)
    const idRes = await call(identify, new Request("http://x/auth-identify", {
      method: "POST",
      body: JSON.stringify({ xuid: "9e2601d1b5a040ec9fc5ef164f3c6046", player_name: "Felix", email: "Felix@Example.com" }),
    }));
    const idBody = await idRes.json();

    // stats: wrong secret rejected
    const bad = await call(adminStats, new Request("http://x/admin-stats", {
      headers: { Authorization: "Bearer nope" },
    }));
    assertEquals(bad.status, 401);

    // stats: valid secret -> 1 user, 1 online
    const stats = await call(adminStats, new Request("http://x/admin-stats", {
      headers: { Authorization: `Bearer ${ADMIN}` },
    }));
    assertEquals(stats.status, 200);
    let st = await stats.json();
    assertEquals(st.users_total, 1);
    assertEquals(st.online_count, 1);
    assertEquals(st.online_users[0].player_name, "Felix");
    assertEquals(st.online_users[0].email, "felix@example.com");

    // grant premium for 30 days
    const grant = await call(adminGrant, new Request("http://x/admin-grant", {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN}` },
      body: JSON.stringify({ xuid: "9e2601d1b5a040ec9fc5ef164f3c6046", tier: "premium", days: 30 }),
    }));
    assertEquals(grant.status, 200);

    // premium status now returns premium
    const prem = await call(premiumStatus, new Request("http://x/premium-status", {
      headers: { Authorization: `Bearer ${idBody.session_token}` },
    }));
    assertEquals((await prem.json()).tier, "premium");

    // grant premium by email (case-insensitive) -> same user
    const grantByEmail = await call(adminGrant, new Request("http://x/admin-grant", {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN}` },
      body: JSON.stringify({ email: "FELIX@example.com", tier: "premium", days: 60 }),
    }));
    assertEquals(grantByEmail.status, 200);
    const grantBody = await grantByEmail.json();
    assertEquals(grantBody.xuid, "9e2601d1b5a040ec9fc5ef164f3c6046");

    // unknown email -> 404
    const grantMiss = await call(adminGrant, new Request("http://x/admin-grant", {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN}` },
      body: JSON.stringify({ email: "nobody@example.com", tier: "premium", days: 30 }),
    }));
    assertEquals(grantMiss.status, 404);

    // grant lifetime -> no expiry
    const grantLife = await call(adminGrant, new Request("http://x/admin-grant", {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN}` },
      body: JSON.stringify({ email: "felix@example.com", tier: "lifetime", days: 0 }),
    }));
    assertEquals(grantLife.status, 200);
    const lifeBody = await grantLife.json();
    assertEquals(lifeBody.expires_at, null);

    const premLife = await call(premiumStatus, new Request("http://x/premium-status", {
      headers: { Authorization: `Bearer ${idBody.session_token}` },
    }));
    const premLifeBody = await premLife.json();
    assertEquals(premLifeBody.tier, "premium");
    assertEquals(premLifeBody.expires_at, null);

    // stats reflects premium_count
    const st2 = await (await call(adminStats, new Request("http://x/admin-stats", {
      headers: { Authorization: `Bearer ${ADMIN}` },
    }))).json();
    assertEquals(st2.premium_count, 1);

    // post news, list them, check RSS
    const post = await call(adminNews, new Request("http://x/admin-news", {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN}` },
      body: JSON.stringify({ action: "post", title: "v1.1 released!", body: "Fixes and <b>speed</b>", link: "https://ax-client.com/v1" }),
    }));
    assertEquals(post.status, 200);

    const rss = await call(newsRss, new Request("http://x/news-rss"));
    assertEquals(rss.status, 200);
    const xml = await rss.text();
    assert(xml.includes("v1.1 released!"), "rss contains news title");
    assert(xml.includes("Fixes and &lt;b&gt;speed&lt;/b&gt;"), "rss escapes html");

    const list = await call(adminNews, new Request("http://x/admin-news", {
      headers: { Authorization: `Bearer ${ADMIN}` },
    }));
    const items = await list.json();
    assertEquals(items.length, 1);
    assertEquals(items[0].title, "v1.1 released!");

    // delete
    const del = await call(adminNews, new Request("http://x/admin-news", {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN}` },
      body: JSON.stringify({ action: "delete", id: items[0].id }),
    }));
    assertEquals(del.status, 200);
    const list2 = await (await call(adminNews, new Request("http://x/admin-news", {
      headers: { Authorization: `Bearer ${ADMIN}` },
    }))).json();
    assertEquals(list2.length, 0);
  } finally {
    await server.shutdown();
    Deno.env.delete("SUPABASE_URL");
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    Deno.env.delete("AX_ADMIN_SECRET");
  }
});

Deno.test("world transfer: create -> upload -> confirm -> poll -> download -> ack", async () => {
  const server = await boot();

  try {
    // identify -> session (reuse the xuid pattern)
    const idRes = await call(identify, new Request("http://x/auth-identify", {
      method: "POST",
      body: JSON.stringify({ xuid: "9e2601d1b5a040ec9fc5ef164f3c6046" }),
    }));
    const idBody = await idRes.json();
    const auth = { Authorization: `Bearer ${idBody.session_token}` };

    // create transfer (uploader side)
    const create = await call(worldTransfer, new Request("http://x/world-transfer", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ action: "create", name: "Survival-20260812-1200.zip", size: 1024 }),
    }));
    assertEquals(create.status, 200);
    const created = await create.json();
    assert(created.upload_url.includes("/fake-upload/"), "signed upload url issued");

    // a second create while active -> 409
    const dup = await call(worldTransfer, new Request("http://x/world-transfer", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ action: "create", name: "other.zip", size: 10 }),
    }));
    assertEquals(dup.status, 409);

    // upload via signed url (direct client PUT)
    const put = await fetch(created.upload_url, { method: "PUT", body: new Uint8Array(1024) });
    assertEquals(put.status, 200);

    // confirm
    const conf = await call(worldTransfer, new Request("http://x/world-transfer", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ action: "confirm", id: created.id }),
    }));
    assertEquals(conf.status, 200);

    // poll on another device -> transfer visible with signed download url
    const pollRes = await call(
      worldTransfer,
      new Request(`http://x/world-transfer?action=poll&device_id=device-b`, { headers: auth }),
    );
    assertEquals(pollRes.status, 200);
    const pollBody = await pollRes.json();
    assertEquals(pollBody.transfers.length, 1);
    assertEquals(pollBody.transfers[0].name, "Survival-20260812-1200.zip");
    const dlUrl = pollBody.transfers[0].download_url;
    assert(dlUrl.includes("/fake-download/"), "signed download url issued");

    // download + ack (device-b received it)
    const dl = await fetch(dlUrl);
    assertEquals(await dl.text(), "FAKE-ZIP");

    const ack = await call(worldTransfer, new Request("http://x/world-transfer", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ action: "ack", id: created.id, device_id: "device-b" }),
    }));
    assertEquals(ack.status, 200);

    // device-b polls again -> nothing left for it
    const poll2 = await call(
      worldTransfer,
      new Request(`http://x/world-transfer?action=poll&device_id=device-b`, { headers: auth }),
    );
    assertEquals((await poll2.json()).transfers.length, 0);

    // another device (c) still sees it
    const poll3 = await call(
      worldTransfer,
      new Request(`http://x/world-transfer?action=poll&device_id=device-c`, { headers: auth }),
    );
    assertEquals((await poll3.json()).transfers.length, 1);
  } finally {
    await server.shutdown();
    Deno.env.delete("SUPABASE_URL");
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
});

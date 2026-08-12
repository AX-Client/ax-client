// POST /world-transfer  Authorization: Bearer <session_token>
// body: { action: "create"|"confirm"|"ack", ... }
// GET  /world-transfer  ?action=poll  Authorization: Bearer <session_token>
//
// Short-lived world backup transfer between the user's own devices:
//  - create: reserves a signed upload URL (30 min TTL)
//  - confirm: marks the upload as ready for download
//  - poll:   lists active ready transfers (gc'ing expired ones)
//  - ack:    device has received the backup (won't be offered to it again)
import { json, rest, sessionUser, storage } from "../_shared/helpers.ts";

const BUCKET = "world-transfer";
const TTL_SEC = 30 * 60; // 30 minutes
const MAX_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB
const DOWNLOAD_URL_TTL = 600; // 10 min

const enc = (s: string) => encodeURIComponent(s);

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "access-control-allow-origin": "*" } });
  }

  const xuid = await sessionUser(req);
  if (!xuid) return json(401, { error: "invalid or expired session" });

  if (req.method === "GET" && new URL(req.url).searchParams.get("action") === "poll") {
    const deviceId = new URL(req.url).searchParams.get("device_id") ?? "";
    return poll(xuid, deviceId);
  }
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  let body: { action?: string; name?: string; size?: number; id?: string; device_id?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid body" });
  }

  switch (body.action) {
    case "create":
      return create(xuid, String(body.name ?? ""), Number(body.size ?? 0));
    case "confirm":
      return confirm(xuid, String(body.id ?? ""));
    case "ack":
      return ack(xuid, String(body.id ?? ""), String(body.device_id ?? ""));
    default:
      return json(400, { error: "unknown action" });
  }
};

async function create(xuid: string, name: string, size: number): Promise<Response> {
  if (!name || size <= 0) return json(400, { error: "missing name or size" });
  if (size > MAX_SIZE) return json(400, { error: "backup too large (max 2 GB)" });

  // only one active transfer per user
  const active = await rest(
    "GET",
    `/ax_world_transfers?select=id&xuid=eq.${enc(xuid)}&expires_at=gt.${now()}&status=in.("uploading","ready")`,
  );
  if (Array.isArray(active.data) && active.data.length > 0) {
    return json(409, { error: "a transfer is still active" });
  }

  const objectKey = `world-transfer/${xuid}/${crypto.randomUUID()}.zip`;
  const sign = await storage(
    "POST",
    `/object/upload/sign/${BUCKET}/${objectKey}`,
    { expiresIn: TTL_SEC, contentType: "application/zip" },
  );
  const uploadUrl = resolveSignedUrl(sign.data);
  if (sign.status === 200 && uploadUrl) {
    return finishCreate(xuid, name, size, objectKey, uploadUrl);
  }
  const missingBucket = JSON.stringify(sign.data ?? "").match(/does not exist|not found/i) !== null;
  let bucketSetup: unknown = null;
  let retrySetup: unknown = null;
  if (sign.status === 404 || missingBucket) {
    // bucket missing - create it once (private)
    const bres = await storage("POST", "/bucket", { name: BUCKET, public: false });
    bucketSetup = { status: bres.status, data: bres.data };
    const retry = await storage(
      "POST",
      `/object/upload/sign/${BUCKET}/${objectKey}`,
      { expiresIn: TTL_SEC, contentType: "application/zip" },
    );
    retrySetup = { status: retry.status, data: retry.data };
    const retryUrl = resolveSignedUrl(retry.data);
    if (retry.status === 200 && retryUrl) {
      return finishCreate(xuid, name, size, objectKey, retryUrl);
    }
  }
  return json(500, {
    error: "could not create upload url",
    sign: { status: sign.status, data: sign.data },
    bucket: bucketSetup,
    retry: retrySetup,
  });
}

/// Storage sign endpoints answer with either `signedUrl`, `signedURL` or a
/// relative `url` - normalize all of them to an absolute URL.
function resolveSignedUrl(data: unknown): string {
  const d = data as { signedUrl?: string; signedURL?: string; url?: string } | null;
  const raw = d?.signedUrl ?? d?.signedURL ?? d?.url ?? "";
  if (!raw) return "";
  if (raw.startsWith("http")) return raw;
  return `${Deno.env.get("SUPABASE_URL") ?? ""}/storage/v1${raw}`;
}

async function finishCreate(
  xuid: string,
  name: string,
  size: number,
  objectKey: string,
  signedUrl: string,
): Promise<Response> {

  const insert = await insertReturning("ax_world_transfers", {
    xuid,
    name,
    size,
    status: "uploading",
    object_key: objectKey,
    expires_at: iso(),
  });
  const created = Array.isArray(insert.data) && insert.data.length > 0 ? insert.data[0] : null;
  if (!created?.id) {
    return json(500, { error: "could not register transfer", insert: { status: insert.status, data: insert.data } });
  }

  return json(200, { ok: true, id: created.id, upload_url: signedUrl });
}

/// Insert with `Prefer: return=representation` so the created row (incl. the
/// server-generated uuid) comes back (rest() uses return=minimal).
async function insertReturning(
  table: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: unknown }> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const res = await fetch(`${url}/rest/v1/${table}?select=id`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function confirm(xuid: string, id: string): Promise<Response> {
  const row = await rest("GET", `/ax_world_transfers?select=id&xuid=eq.${enc(xuid)}&id=eq.${enc(id)}`);
  const found = Array.isArray(row.data) && row.data.length > 0 ? row.data[0] : null;
  if (!found) return json(404, { error: "unknown transfer" });
  await rest("PATCH", `/ax_world_transfers?id=eq.${enc(id)}`, { status: "ready" });
  return json(200, { ok: true });
}

async function poll(xuid: string, deviceId: string): Promise<Response> {
  // gc: drop expired transfers (object + row)
  const expired = await rest(
    "GET",
    `/ax_world_transfers?select=id,object_key&xuid=eq.${enc(xuid)}&expires_at=lt.${now()}`,
  );
  for (const r of (expired.data as Array<{ id: string; object_key: string }>) ?? []) {
    await storage("DELETE", `/object/${BUCKET}/${r.object_key}`);
    await rest("DELETE", `/ax_world_transfers?id=eq.${enc(r.id)}`);
  }

  const devFilter = deviceId ? `&device_ids=not.cs.${encodeURIComponent(JSON.stringify(deviceId))}` : "";
  const rows = await rest(
    "GET",
    `/ax_world_transfers?select=id,name,size,object_key&xuid=eq.${enc(xuid)}&status=eq.ready&expires_at=gt.${now()}${devFilter}`,
  );
  if (!Array.isArray(rows.data)) {
    return json(200, { transfers: [], debug: { status: rows.status, data: rows.data } });
  }
  const list = (rows.data as Array<{ id: string; name: string; size: number; object_key: string }>) ?? [];
  const transfers = [];
  const signErrors = [];
  for (const r of list) {
    const sign = await storage("POST", `/object/sign/${BUCKET}/${r.object_key}`, { expiresIn: DOWNLOAD_URL_TTL });
    const downloadUrl = resolveSignedUrl(sign.data);
    if (sign.status !== 200 || !downloadUrl) {
      signErrors.push({ key: r.object_key, status: sign.status, data: sign.data });
      continue;
    }
    transfers.push({ id: r.id, name: r.name, size: r.size, download_url: downloadUrl });
  }
  return json(200, signErrors.length ? { transfers, signErrors } : { transfers });
}

async function ack(xuid: string, id: string, deviceId: string): Promise<Response> {
  if (!deviceId) return json(400, { error: "missing device_id" });
  const row = await rest("GET", `/ax_world_transfers?select=device_ids&xuid=eq.${enc(xuid)}&id=eq.${enc(id)}`);
  const found = Array.isArray(row.data) && row.data.length > 0 ? row.data[0] : null;
  if (!found) return json(404, { error: "unknown transfer" });
  const devices = Array.isArray(found.device_ids) ? found.device_ids : [];
  if (!devices.includes(deviceId)) {
    await rest("PATCH", `/ax_world_transfers?id=eq.${enc(id)}`, { device_ids: [...devices, deviceId] });
  }
  return json(200, { ok: true });
}

function iso(): string {
  return new Date(Date.now() + TTL_SEC * 1000).toISOString();
}

function now(): string {
  return new Date().toISOString();
}

if (import.meta.main) {
  Deno.serve(handler);
}
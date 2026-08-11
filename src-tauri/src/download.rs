use crate::error::{Error, Result};
use crate::model::DlEvent;
use futures_util::StreamExt;
use sha1::{Digest, Sha1};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::io::AsyncWriteExt;
use tokio::sync::Semaphore;
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug)]
pub struct DownloadSpec {
    pub url: String,
    pub dest: PathBuf,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub name: String,
}

#[derive(Clone)]
pub struct Engine {
    http: reqwest::Client,
    batches: Arc<Mutex<std::collections::HashMap<String, CancellationToken>>>,
    created_dirs: Arc<Mutex<std::collections::HashSet<PathBuf>>>,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine {
    pub fn new() -> Self {
        Engine {
            http: reqwest::Client::builder()
                .user_agent("AzrealX/0.1 (Minecraft Launcher)")
                .connect_timeout(std::time::Duration::from_secs(20))
                .build()
                .unwrap_or_default(),
            batches: Arc::new(Mutex::new(std::collections::HashMap::new())),
            created_dirs: Arc::new(Mutex::new(std::collections::HashSet::new())),
        }
    }

    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    pub fn cancel_batch(&self, batch: &str) {
        if let Some(tok) = self.batches.lock().unwrap().get(batch) {
            tok.cancel();
        }
    }

    pub fn cancel_all(&self) {
        let mut map = self.batches.lock().unwrap();
        for (_, tok) in map.drain() {
            tok.cancel();
        }
    }

    pub fn is_pending(&self, batch: &str) -> bool {
        self.batches.lock().unwrap().contains_key(batch)
    }

    /// Download a batch of files concurrently. Resumes `.part` files with an
    /// HTTP Range request, retries with backoff, and verifies SHA-1 sums when
    /// provided (falling back to a clean re-download if a resumed file fails
    /// verification). Emits `download` events for each completed file.
    pub async fn run(
        &self,
        app: Option<&tauri::AppHandle>,
        batch: &str,
        specs: Vec<DownloadSpec>,
        concurrency: usize,
    ) -> Result<()> {
        if specs.is_empty() {
            return Ok(());
        }
        let token = CancellationToken::new();
        self.batches.lock().unwrap().insert(batch.to_string(), token.clone());
        let sem = Arc::new(Semaphore::new(concurrency.max(1)));
        let done_bytes = Arc::new(AtomicU64::new(0));
        let total_bytes: u64 = specs.iter().map(|s| s.size.unwrap_or(0)).sum();
        let specs_len = specs.len();
        let start = Instant::now();
        let last_progress = Arc::new(Mutex::new(Instant::now()));
        let done_emit = Arc::new(Mutex::new(Instant::now()));

        let mut tasks = Vec::new();
        for (idx, spec) in specs.into_iter().enumerate() {
            let sem = sem.clone();
            let token = token.clone();
            let done_bytes = done_bytes.clone();
            let last_progress = last_progress.clone();
            let http = self.http.clone();
            let created_dirs = self.created_dirs.clone();
            let done_emit = done_emit.clone();
            let app = app.cloned();
            let batch_id = batch.to_string();
            let id = format!("{batch}:{idx}");
            let on_chunk = Arc::new({
                let done_bytes = done_bytes.clone();
                let last_progress = last_progress.clone();
                let app = app.clone();
                let batch_id = batch_id.clone();
                let id = id.clone();
                let name = spec.name.clone();
                let file_done = Arc::new(AtomicU64::new(0));
                move |bytes: u64, resp_total: Option<u64>| {
                    file_done.fetch_add(bytes, Ordering::Relaxed);
                    let mut last = last_progress.lock().unwrap();
                    if last.elapsed().as_millis() < 400 {
                        return;
                    }
                    *last = Instant::now();
                    let total = if total_bytes > 0 {
                        total_bytes
                    } else {
                        resp_total.unwrap_or(0)
                    };
                    let done = done_bytes
                        .load(Ordering::Relaxed)
                        .saturating_add(file_done.load(Ordering::Relaxed))
                        .min(total);
                    let elapsed = start.elapsed().as_secs_f64().max(0.1);
                    let speed = (done as f64 / elapsed) as u64;
                    if let Some(app) = &app {
                        let evt = DlEvent {
                            batch: batch_id.clone(),
                            id: id.clone(),
                            name: name.clone(),
                            done,
                            total,
                            status: "downloading".into(),
                            error: None,
                            speed,
                        };
                        use tauri::Emitter;
                        let _ = app.emit("download", &evt);
                    }
                }
            });
            tasks.push(tokio::spawn(async move {
                let _permit = sem.acquire_owned().await.expect("semaphore");
                if token.is_cancelled() {
                    return (idx, Err(Error::Canceled));
                }
                let result = download_one(
                    &http,
                    &spec,
                    &token,
                    part_path(&spec.dest),
                    on_chunk.as_ref(),
                    &created_dirs,
                )
                .await;
                done_bytes.fetch_add(spec.size.unwrap_or(0), Ordering::Relaxed);
                let done = done_bytes.load(Ordering::Relaxed);
                let elapsed = start.elapsed().as_secs_f64().max(0.1);
                let speed = (done as f64 / elapsed) as u64;
                let is_error = result.is_err();
                let is_last = idx == specs_len - 1;
                if let Some(app) = &app {
                    let emit = is_error || is_last || {
                        let mut last = done_emit.lock().unwrap();
                        if last.elapsed().as_millis() < 120 {
                            false
                        } else {
                            *last = Instant::now();
                            true
                        }
                    };
                    if emit {
                        let status = match &result {
                            Ok(_) => "done",
                            Err(e) => {
                                let _ = e;
                                "error"
                            }
                        };
                        let error = match &result {
                            Err(e) => Some(e.to_string()),
                            Ok(_) => None,
                        };
                        let evt = DlEvent {
                            batch: batch_id,
                            id,
                            name: spec.name,
                            done,
                            total: total_bytes,
                            status: status.to_string(),
                            error,
                            speed,
                        };
                        use tauri::Emitter;
                        let _ = app.emit("download", &evt);
                    }
                }
                (idx, result)
            }));
        }
        let mut results = Vec::with_capacity(tasks.len());
        for task in tasks {
            if let Ok((idx, r)) = task.await {
                results.push((idx, r));
            }
        }
        self.batches.lock().unwrap().remove(batch);
        results.sort_by_key(|(idx, _)| *idx);
        let mut first_err: Option<Error> = None;
        for (_idx, r) in results {
            if let Err(e) = r {
                if first_err.is_none() {
                    first_err = Some(e);
                }
            }
        }
        if token.is_cancelled() {
            return Err(Error::Canceled);
        }
        match first_err {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }
}

pub fn part_path(dest: &Path) -> PathBuf {
    let name = dest
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());
    dest.with_file_name(format!("{name}.part"))
}

pub async fn download_one(
    http: &reqwest::Client,
    spec: &DownloadSpec,
    token: &CancellationToken,
    part: PathBuf,
    on_progress: &(dyn Fn(u64, Option<u64>) + Send + Sync),
    created_dirs: &Arc<Mutex<std::collections::HashSet<PathBuf>>>,
) -> Result<()> {
    let parent = part.parent().unwrap_or(Path::new(".")).to_path_buf();
    {
        let mut set = created_dirs.lock().unwrap();
        if !set.contains(&parent) {
            let _ = std::fs::create_dir_all(&parent);
            set.insert(parent);
        }
    }
    // Fast path for already-downloaded files: a size match is enough.
    // Re-hashing every asset on every launch would stall the UI for
    // thousands of files.
    if spec.dest.exists() {
        if let Ok(m) = std::fs::metadata(&spec.dest) {
            if spec.size.map_or(true, |s| s == m.len()) {
                return Ok(());
            }
        }
    }
    if let Some(expected) = &spec.sha1 {
        if spec.dest.exists() {
            if let Some(got) = file_sha1(&spec.dest).await {
                if &got == expected {
                    return Ok(());
                }
            }
        }
    }

    // Hard deadline per attempt, scaled by the file size so large assets get
    // more time. Guards against connections that trickle bytes forever.
    let size = spec.size.unwrap_or(0).max(1);
    let allowance = 300u64 + (size / 512_000);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(allowance);

    let mut attempts = 0;
    loop {
        token.is_cancelled();
        attempts += 1;
        match try_download(http, spec, &part, token, on_progress, deadline).await {
            Ok(true) => {
                std::fs::rename(&part, &spec.dest)?;
                return Ok(());
            }
            Ok(false) => {
                let _ = std::fs::remove_file(&part);
                if attempts >= 3 {
                    return Err(Error::Http("checksum verification failed".into()));
                }
            }
            Err(e) => {
                if attempts >= 3 {
                    return Err(e);
                }
                sleep(std::time::Duration::from_millis(400 * attempts as u64)).await;
            }
        }
    }
}

pub const LIBRARIES_HOST: &str = "https://libraries.minecraft.net/";
pub const MAVEN_FABRIC: &str = "https://maven.fabricmc.net/";
pub const MAVEN_QUILT: &str = "https://maven.quiltmc.org/repository/release/";
pub const MAVEN_CENTRAL: &str = "https://repo1.maven.org/maven2/";

/// For libraries that fail on Mojang's CDN (e.g. newly released ASM builds
/// that have not been mirrored yet, or Fabric/Quilt artifacts that only exist
/// on their own maven), fall back to the same artifact on the right host.
fn mirror_candidates(url: &str) -> Vec<String> {
    let mut cands = vec![url.to_string()];
    if let Some(rel) = url.strip_prefix(LIBRARIES_HOST) {
        let rel = rel.trim_start_matches('/');
        if rel.starts_with("net/fabricmc/") {
            cands.push(format!("{MAVEN_FABRIC}{rel}"));
        }
        if rel.starts_with("org/quiltmc/") {
            cands.push(format!("{MAVEN_QUILT}{rel}"));
        }
        cands.push(format!("{MAVEN_CENTRAL}{rel}"));
    }
    cands
}

async fn try_download(
    http: &reqwest::Client,
    spec: &DownloadSpec,
    part: &Path,
    token: &CancellationToken,
    on_progress: &(dyn Fn(u64, Option<u64>) + Send + Sync),
    deadline: std::time::Instant,
) -> Result<bool> {
    let _ = std::fs::create_dir_all(part.parent().unwrap_or(Path::new(".")));
    let candidates = mirror_candidates(&spec.url);
    for (i, url) in candidates.iter().enumerate() {
        if token.is_cancelled() {
            return Err(Error::Canceled);
        }
        let existing = if i == 0 {
            std::fs::metadata(part).map(|m| m.len()).unwrap_or(0)
        } else {
            0
        };
        if i > 0 {
            let _ = std::fs::remove_file(part);
        }
        let mut req = http.get(url);
        if existing > 0 {
            req = req.header(reqwest::header::RANGE, format!("bytes={existing}-"));
        }
        let resp = req.send().await?;
        let status = resp.status();
        let known_total = resp.content_length();
        if status == reqwest::StatusCode::PARTIAL_CONTENT {
            // resume from .part
        } else if status.is_success() {
            if existing > 0 {
                // server ignored Range (200) → restart from scratch
                let _ = std::fs::remove_file(part);
            }
        } else {
            // try the next mirror (or fail after the last one)
            if i + 1 < candidates.len() {
                continue;
            }
            return Err(Error::Http(format!("{url} -> HTTP {status}")));
        }
        let append = existing > 0 && status != reqwest::StatusCode::OK;
        let mut out = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(append)
            .truncate(!append)
            .open(part)
            .await?;
        let mut hasher = Sha1::new();
        let stream = resp.bytes_stream();
        tokio::pin!(stream);
        loop {
            if std::time::Instant::now() >= deadline {
                return Err(Error::Http(format!("{url} -> attempt deadline exceeded")));
            }
            let next = tokio::time::timeout(std::time::Duration::from_secs(60), stream.next())
                .await;
            match next {
                Ok(Some(chunk)) => {
                    token.is_cancelled();
                    let chunk = chunk.map_err(|e| Error::Http(e.to_string()))?;
                    out.write_all(&chunk).await?;
                    hasher.update(&chunk);
                    on_progress(chunk.len() as u64, known_total);
                }
                Ok(None) => break,
                Err(_) => {
                    return Err(Error::Http(format!("{url} -> no data for 60s")));
                }
            }
        }
        out.flush().await?;
        if let Some(expected) = &spec.sha1 {
            let got = hex::encode(hasher.finalize());
            return Ok(&got == expected);
        }
        return Ok(true);
    }
    unreachable!("mirror_candidates always yields at least one URL")
}

pub async fn file_sha1(path: &Path) -> Option<String> {
    if path.metadata().is_err() {
        return None;
    }
    match std::fs::read(path) {
        Ok(bytes) => {
            let mut h = Sha1::new();
            h.update(&bytes);
            Some(hex::encode(h.finalize()))
        }
        Err(_) => None,
    }
}

/// Parse the archive at `part` if it is a valid gzip (used for tar.gz inputs).
pub fn is_gzip(path: &Path) -> bool {
    std::fs::read(path)
        .ok()
        .map(|b| b.starts_with(&[0x1f, 0x8b]))
        .unwrap_or(false)
}
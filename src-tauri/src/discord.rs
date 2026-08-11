use serde_json::json;
use std::io::{Read, Write};
use std::sync::mpsc::{self, Sender};
use std::time::{Duration, Instant};

#[derive(Clone, Debug, Default)]
pub struct Activity {
    pub state: Option<String>,
    pub details: Option<String>,
    pub image_key: Option<String>,
    pub image_text: Option<String>,
}

/// Minimal Discord Rich Presence client over the IPC socket protocol.
/// Best-effort: all failures are swallowed and logged at debug level.
pub struct DiscordRpc {
    tx: Sender<Option<Activity>>,
}

impl DiscordRpc {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || worker(rx));
        DiscordRpc { tx }
    }

    pub fn set_activity(&self, activity: Activity) {
        let _ = self.tx.send(Some(activity));
    }

    pub fn clear(&self) {
        let _ = self.tx.send(None);
    }

    #[allow(dead_code)]
    pub fn ready(&self) {}
}

impl Default for DiscordRpc {
    fn default() -> Self {
        DiscordRpc::new()
    }
}

enum Pipe {
    #[cfg(unix)]
    #[allow(dead_code)]
    Unix(std::os::unix::net::UnixStream),
    #[cfg(not(unix))]
    File(std::fs::File),
}

impl Read for Pipe {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            #[cfg(unix)]
            Pipe::Unix(s) => s.read(buf),
            #[cfg(not(unix))]
            Pipe::File(f) => f.read(buf),
        }
    }
}

impl Write for Pipe {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match self {
            #[cfg(unix)]
            Pipe::Unix(s) => s.write(buf),
            #[cfg(not(unix))]
            Pipe::File(f) => f.write(buf),
        }
    }
    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            #[cfg(unix)]
            Pipe::Unix(s) => s.flush(),
            #[cfg(not(unix))]
            Pipe::File(f) => f.flush(),
        }
    }
}

fn ipc_paths() -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    #[cfg(unix)]
    {
        if cfg!(target_os = "macos") {
            if let Ok(home) = std::env::var("HOME") {
                let base = format!("{home}/Library/Application Support/discord");
                for i in 0..3 {
                    out.push(std::path::PathBuf::from(format!("{base}/discord-ipc-{i}")));
                }
            }
        } else if let Ok(runtime) = std::env::var("XDG_RUNTIME_DIR") {
            for i in 0..3 {
                out.push(std::path::PathBuf::from(format!("{runtime}/discord-ipc-{i}")));
            }
        }
    }
    #[cfg(not(unix))]
    {
        for i in 0..3 {
            out.push(std::path::PathBuf::from(format!(r"\\.\pipe\discord-ipc-{i}")));
        }
    }
    out
}

fn try_connect() -> Option<Pipe> {
    for p in ipc_paths() {
        #[cfg(unix)]
        {
            if let Ok(s) = std::os::unix::net::UnixStream::connect(&p) {
                return Some(Pipe::Unix(s));
            }
        }
        #[cfg(not(unix))]
        {
            if let Ok(f) = std::fs::OpenOptions::new().read(true).write(true).open(&p) {
                return Some(Pipe::File(f));
            }
        }
    }
    None
}

fn write_packet(pipe: &mut Pipe, opcode: u32, payload: &[u8]) -> bool {
    let mut header = Vec::with_capacity(8);
    header.extend_from_slice(&opcode.to_le_bytes());
    header.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    pipe.write_all(&header).is_ok() && pipe.write_all(payload).is_ok() && pipe.flush().is_ok()
}

fn read_packet(pipe: &mut Pipe) -> Option<(u32, Vec<u8>)> {
    let mut header = [0u8; 8];
    pipe.read_exact(&mut header).ok()?;
    let opcode = u32::from_le_bytes(header[0..4].try_into().ok()?);
    let len = u32::from_le_bytes(header[4..8].try_into().ok()?) as usize;
    let mut payload = vec![0u8; len.min(1 << 20)];
    pipe.read_exact(&mut payload).ok()?;
    Some((opcode, payload))
}

fn worker(rx: mpsc::Receiver<Option<Activity>>) {
    let mut pipe: Option<Pipe> = None;
    let mut last_sent: Option<Activity> = None;
    let mut last_tick = Instant::now();
    const CLIENT_ID: &str = "1184969228400324672";

    loop {
        let mut pending: Option<Option<Activity>> = None;
        loop {
            match rx.try_recv() {
                Ok(msg) => pending = Some(msg),
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => return,
            }
        }
        let changed = match pending {
            Some(m) => {
                last_sent = m;
                true
            }
            None => false,
        };

        if pipe.is_none() {
            pipe = try_connect();
            if let Some(conn) = pipe.as_mut() {
                let hello = json!({ "v": 1, "client_id": CLIENT_ID }).to_string();
                if !write_packet(conn, 0, hello.as_bytes()) {
                    pipe = None;
                } else if let Some((op, _)) = read_packet(conn) {
                    if op == 1 {
                        log::info!("Discord Rich Presence connected");
                    }
                }
            }
        }

        let tick = changed || last_tick.elapsed() >= Duration::from_secs(15);
        if !tick {
            std::thread::sleep(Duration::from_millis(500));
            continue;
        }

        if let Some(activity) = &last_sent {
            let payload = json!({
                "pid": std::process::id(),
                "activity": {
                    "type": 0,
                    "state": activity.state,
                    "details": activity.details,
                    "assets": {
                        "large_image": activity.image_key,
                        "large_text": activity.image_text
                    },
                    "timestamps": {
                        "start": chrono::Utc::now().timestamp()
                    }
                }
            })
            .to_string();
            if let Some(conn) = pipe.as_mut() {
                if !write_packet(conn, 1, payload.as_bytes()) {
                    log::debug!("Discord RPC disconnected");
                    pipe = None;
                } else {
                    last_tick = Instant::now();
                }
            }
        }
        std::thread::sleep(Duration::from_millis(2500));
    }
}
use crate::error::{Error, Result};
use chrono::Local;
use serde::Serialize;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};

#[derive(Clone, Serialize)]
pub struct LogLine {
    pub level: String,
    pub msg: String,
    pub ts: String,
}

pub struct Logger {
    tx: Option<tokio::sync::mpsc::UnboundedSender<LogLine>>,
    min: AtomicU8,
}

static LOGGER: OnceLock<Logger> = OnceLock::new();
static _KEEP: AtomicU8 = AtomicU8::new(0);
static BUFFER: Mutex<Vec<String>> = Mutex::new(Vec::new());
static LOG_FILE: Mutex<Option<PathBuf>> = Mutex::new(None);

fn level_num(level: log::Level) -> u8 {
    match level {
        log::Level::Error => 1,
        log::Level::Warn => 2,
        log::Level::Info => 3,
        log::Level::Debug => 4,
        log::Level::Trace => 5,
    }
}

pub fn data_dir() -> Result<PathBuf> {
    let dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("AzrealX");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn file_handle() -> Option<std::fs::File> {
    let dir = data_dir().ok()?;
    let path = dir.join("client.log");
    if let Ok(mut slot) = LOG_FILE.lock() {
        *slot = Some(path.clone());
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .ok()
}

impl log::Log for Logger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        level_num(metadata.level()) <= self.min.load(Ordering::Relaxed)
    }

    fn log(&self, record: &log::Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let level = record.level().to_string();
        let msg = record.args().to_string();
        let ts = Local::now().format("%H:%M:%S").to_string();
        let line = format!("[{}] {level}: {msg}", ts);

        if let Some(tx) = &self.tx {
            let _ = tx.send(LogLine {
                level: level.clone(),
                msg: msg.clone(),
                ts: ts.clone(),
            });
        }
        if let Ok(mut buf) = BUFFER.lock() {
            buf.push(line.clone());
            if buf.len() > 4000 {
                let keep = buf.len() - 3000;
                buf.drain(0..keep);
            }
        }
        if level == "ERROR" || level == "WARN" {
            let _ = write!(std::io::stderr(), "{line}\n");
        } else {
            let _ = write!(std::io::stdout(), "{line}\n");
        }
        if let Some(mut f) = file_handle() {
            let _ = writeln!(f, "{line}");
        }
    }

    fn flush(&self) {}
}

pub fn install(
    tx: Option<tokio::sync::mpsc::UnboundedSender<LogLine>>,
    min: log::LevelFilter,
) -> Result<()> {
    let logger = Logger {
        tx,
        min: AtomicU8::new(level_num(min.to_level().unwrap_or(log::Level::Info))),
    };
    let installed = LOGGER.get_or_init(|| logger);
    log::set_logger(installed)
        .map_err(|e| Error::InvalidInput(format!("logger already set: {e}")))?;
    log::set_max_level(min);
    Ok(())
}

/// Non-fatal bootstrap logger: never fails, never panics.
pub fn install_best_effort(tx: tokio::sync::mpsc::UnboundedSender<LogLine>) {
    let _ = install(Some(tx), log::LevelFilter::Info);
}

pub fn set_level(level: log::LevelFilter) {
    let n = level_num(level.to_level().unwrap_or(log::Level::Info));
    if let Some(l) = LOGGER.get() {
        l.min.store(n, Ordering::Relaxed);
    }
    log::set_max_level(level);
}

/// Recent launcher log lines (most recent first).
pub fn buffered(limit: usize) -> Vec<String> {
    let buf = BUFFER.lock().unwrap();
    buf.iter().rev().take(limit).cloned().collect()
}

pub fn log_path() -> Option<PathBuf> {
    LOG_FILE.lock().unwrap().clone()
}

#[allow(dead_code)]
pub fn direct(msg: &str) {
    let line = format!("[{}] INFO: {msg}", Local::now().format("%H:%M:%S"));
    if let Ok(mut buf) = BUFFER.lock() {
        buf.push(line.clone());
        if buf.len() > 4000 {
            let keep = buf.len() - 3000;
            buf.drain(0..keep);
        }
    }
    let _ = write!(std::io::stdout(), "{line}\n");
    if let Some(mut f) = file_handle() {
        let _ = writeln!(f, "{line}");
    }
}

#[allow(dead_code)]
fn _keep_mutex_sync() -> Mutex<()> {
    Mutex::new(())
}

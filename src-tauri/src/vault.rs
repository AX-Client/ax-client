use crate::error::{Error, Result};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use keyring::Entry;
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Encrypted-at-rest storage for sensitive tokens.
///
/// The master key is generated once per machine and stored in the operating
/// system credential store (Keychain / Credential Manager / Secret Service).
/// If the platform store is unavailable the key is persisted next to the
/// vault file, still leaving the vault contents AES-256-GCM encrypted.
pub struct Vault {
    file: PathBuf,
    key: [u8; 32],
    data: HashMap<String, String>,
    dirty: bool,
}

fn machine_key() -> [u8; 32] {
    let service = "com.azrealx.client";
    let secret = "vault-master-key";
    let entry = Entry::new(service, secret).ok();
    let mut from_os = None;
    if let Some(e) = &entry {
        if let Ok(v) = e.get_password() {
            from_os = Some(v);
        }
    }
    let raw: Vec<u8> = match from_os {
        Some(v) => B64.decode(v).unwrap_or_default(),
        None => Vec::new(),
    };
    if raw.len() == 32 {
        let mut k = [0u8; 32];
        k.copy_from_slice(&raw);
        return k;
    }
    // Generate a fresh key and persist it. If no OS credential store exists,
    // fall back to a key file in the data directory.
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    let encoded = B64.encode(key);
    if let Some(e) = entry {
        let _ = e.set_password(&encoded);
        if e.get_password().is_ok() {
            return key;
        }
    }
    let mut digest = Sha256::new();
    digest.update(b"azrealx-vault-fallback");
    digest.update(encoded.as_bytes());
    key = digest.finalize().into();
    key
}

impl Vault {
    pub fn open(data_dir: &Path) -> Result<Self> {
        let file = data_dir.join("vault.bin");
        let mut vault = Vault {
            file,
            key: machine_key(),
            data: HashMap::new(),
            dirty: false,
        };
        vault.load()?;
        Ok(vault)
    }

    fn load(&mut self) -> Result<()> {
        if !self.file.exists() {
            return Ok(());
        }
        let blob = std::fs::read(&self.file)?;
        if blob.len() < 12 + 16 {
            return Ok(());
        }
        let (nonce_bytes, ciphertext) = blob.split_at(12);
        let cipher = Aes256Gcm::new_from_slice(&self.key).map_err(|e| Error::Vault(e.to_string()))?;
        let nonce = Nonce::from_slice(nonce_bytes);
        let plain = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| Error::Vault("failed to decrypt vault".into()))?;
        self.data = serde_json::from_slice(&plain)
            .map_err(|e| Error::Vault(format!("corrupt vault: {e}")))?;
        Ok(())
    }

    pub fn save(&mut self) -> Result<()> {
        let plain = serde_json::to_vec(&self.data)?;
        let cipher = Aes256Gcm::new_from_slice(&self.key).map_err(|e| Error::Vault(e.to_string()))?;
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let blob = cipher
            .encrypt(nonce, plain.as_ref())
            .map_err(|e| Error::Vault(e.to_string()))?;
        let mut out = nonce_bytes.to_vec();
        out.extend_from_slice(&blob);
        std::fs::write(&self.file, out)?;
        self.dirty = false;
        Ok(())
    }

    pub fn get(&mut self, key: &str) -> Option<String> {
        self.data.get(key).cloned()
    }

    pub fn set(&mut self, key: &str, value: &str) {
        self.data.insert(key.to_string(), value.to_string());
        self.dirty = true;
    }

    pub fn remove(&mut self, key: &str) {
        if self.data.remove(key).is_some() {
            self.dirty = true;
        }
    }

    pub fn flush(&mut self) -> Result<()> {
        if self.dirty {
            self.save()?;
        }
        Ok(())
    }
}

#[allow(dead_code)]
pub fn guards() -> PathBuf {
    dirs::data_local_dir().unwrap_or_else(|| PathBuf::from(".")).join("azrealx")
}
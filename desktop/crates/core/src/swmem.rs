//! Byte-for-byte port of `src/lib/swmem.ts`.
//!
//! Format (must stay in sync with the TS implementation — round-trip tests
//! verify this):
//!
//! ```text
//! bytes 0..5    "SWMEM1"           magic
//! bytes 6..9    uint32 LE          JSON-header length N
//! bytes 10..N+9 JSON header        encryption metadata (no secrets)
//! bytes N+10..  ciphertext + tag   AES-256-GCM
//! ```
//!
//! Crypto: PBKDF2-SHA256 (600_000 iterations) → AES-256-GCM.
//! Salt = 16 random bytes, nonce = 12 random bytes — both fresh per export
//! and stored base64-encoded in the cleartext header.

use crate::error::{Error, Result};
use crate::types::MemoryExportPayload;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use chrono::Utc;
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

pub const SWMEM_MAGIC: &[u8; 6] = b"SWMEM1";
pub const SWMEM_FORMAT: &str = "statewave-memory-export";
pub const SWMEM_FORMAT_VERSION: u32 = 1;

const KDF_ITERATIONS: u32 = 600_000;
const SALT_BYTES: usize = 16;
const NONCE_BYTES: usize = 12;
const KEY_BYTES: usize = 32;
const MIN_PASSPHRASE_LEN: usize = 8;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwmemHeader {
    pub format: String,
    pub format_version: u32,
    pub encryption_algorithm: String,
    pub kdf: String,
    pub kdf_params: KdfParams,
    pub salt: String,
    pub nonce: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KdfParams {
    pub iterations: u32,
    pub hash: String,
}

#[derive(Debug)]
pub struct DecryptedSwmem {
    pub header: SwmemHeader,
    pub payload: MemoryExportPayload,
}

pub fn encrypt(payload: &MemoryExportPayload, passphrase: &str) -> Result<Vec<u8>> {
    if passphrase.len() < MIN_PASSPHRASE_LEN {
        return Err(Error::Swmem(
            "Passphrase must be at least 8 characters.".into(),
        ));
    }

    let mut salt = [0u8; SALT_BYTES];
    let mut nonce_bytes = [0u8; NONCE_BYTES];
    let mut rng = rand::thread_rng();
    rng.fill_bytes(&mut salt);
    rng.fill_bytes(&mut nonce_bytes);

    let key = derive_key(passphrase, &salt);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

    let plaintext = serde_json::to_vec(payload)?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_ref())
        .map_err(|_| Error::Swmem("AES-GCM encryption failed.".into()))?;

    let header = SwmemHeader {
        format: SWMEM_FORMAT.into(),
        format_version: SWMEM_FORMAT_VERSION,
        encryption_algorithm: "AES-256-GCM".into(),
        kdf: "PBKDF2-SHA256".into(),
        kdf_params: KdfParams {
            iterations: KDF_ITERATIONS,
            hash: "SHA-256".into(),
        },
        salt: B64.encode(salt),
        nonce: B64.encode(nonce_bytes),
        created_at: Utc::now().to_rfc3339(),
    };
    let header_bytes = serde_json::to_vec(&header)?;

    let header_len = u32::try_from(header_bytes.len())
        .map_err(|_| Error::Swmem("header too large".into()))?;
    let mut out = Vec::with_capacity(
        SWMEM_MAGIC.len() + 4 + header_bytes.len() + ciphertext.len(),
    );
    out.extend_from_slice(SWMEM_MAGIC);
    out.extend_from_slice(&header_len.to_le_bytes());
    out.extend_from_slice(&header_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn decrypt(blob: &[u8], passphrase: &str) -> Result<DecryptedSwmem> {
    if blob.len() < SWMEM_MAGIC.len() + 4 {
        return Err(Error::Swmem(
            "Not a Statewave memory archive (.swmem).".into(),
        ));
    }
    if &blob[..SWMEM_MAGIC.len()] != SWMEM_MAGIC {
        return Err(Error::Swmem(
            "Not a Statewave memory archive (.swmem).".into(),
        ));
    }
    let len_off = SWMEM_MAGIC.len();
    let header_len = u32::from_le_bytes(
        blob[len_off..len_off + 4]
            .try_into()
            .map_err(|_| Error::Swmem("Corrupted .swmem header.".into()))?,
    ) as usize;
    let header_start = len_off + 4;
    let header_end = header_start
        .checked_add(header_len)
        .ok_or_else(|| Error::Swmem("Corrupted .swmem header.".into()))?;
    if header_end > blob.len() {
        return Err(Error::Swmem("Corrupted .swmem header.".into()));
    }

    let header: SwmemHeader = serde_json::from_slice(&blob[header_start..header_end])
        .map_err(|_| Error::Swmem("Corrupted .swmem header.".into()))?;

    if header.format != SWMEM_FORMAT {
        return Err(Error::Swmem(format!(
            "Unexpected .swmem format: {}",
            header.format
        )));
    }
    if header.format_version != SWMEM_FORMAT_VERSION {
        return Err(Error::Swmem(format!(
            "Unsupported .swmem format version: {}",
            header.format_version
        )));
    }
    if header.encryption_algorithm != "AES-256-GCM" || header.kdf != "PBKDF2-SHA256" {
        return Err(Error::Swmem(format!(
            "Unsupported .swmem encryption (algo={}, kdf={})",
            header.encryption_algorithm, header.kdf
        )));
    }

    let salt = B64
        .decode(&header.salt)
        .map_err(|_| Error::Swmem("Corrupted .swmem header.".into()))?;
    let nonce = B64
        .decode(&header.nonce)
        .map_err(|_| Error::Swmem("Corrupted .swmem header.".into()))?;

    let key = derive_key(passphrase, &salt);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    // Mirror the TS error message: a tampered ciphertext and a wrong
    // passphrase look identical.
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce), &blob[header_end..])
        .map_err(|_| Error::Swmem("Wrong passphrase or corrupted file.".into()))?;

    let payload: MemoryExportPayload = serde_json::from_slice(&plaintext)
        .map_err(|_| Error::Swmem("Decrypted .swmem payload was not valid JSON.".into()))?;
    if payload.format != "statewave-memory-payload" {
        return Err(Error::Swmem(format!(
            "Decrypted payload has unexpected format: {}",
            payload.format
        )));
    }
    Ok(DecryptedSwmem { header, payload })
}

fn derive_key(passphrase: &str, salt: &[u8]) -> [u8; KEY_BYTES] {
    let mut key = [0u8; KEY_BYTES];
    pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, KDF_ITERATIONS, &mut key);
    key
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_payload() -> MemoryExportPayload {
        MemoryExportPayload {
            format: "statewave-memory-payload".into(),
            format_version: 1,
            export_id: "exp_round_trip".into(),
            exported_at: "2026-05-07T00:00:00Z".into(),
            export_scope: "memories".into(),
            subjects: vec![serde_json::json!({"original_subject_id": "sub_a"})],
            episodes: vec![],
            memories: vec![serde_json::json!({"id": "mem_1", "content": "hello"})],
            sources: vec![],
            metadata: serde_json::json!({}),
        }
    }

    #[test]
    fn round_trip() {
        let p = fixture_payload();
        let blob = encrypt(&p, "correct horse battery staple").unwrap();
        let opened = decrypt(&blob, "correct horse battery staple").unwrap();
        assert_eq!(opened.payload.export_id, "exp_round_trip");
        assert_eq!(opened.header.format, SWMEM_FORMAT);
        assert_eq!(opened.header.format_version, SWMEM_FORMAT_VERSION);
        assert_eq!(opened.header.encryption_algorithm, "AES-256-GCM");
        assert_eq!(opened.header.kdf, "PBKDF2-SHA256");
        assert_eq!(opened.header.kdf_params.iterations, KDF_ITERATIONS);
    }

    #[test]
    fn wrong_passphrase_rejects() {
        let p = fixture_payload();
        let blob = encrypt(&p, "correct horse battery staple").unwrap();
        let err = decrypt(&blob, "wrong passphrase").unwrap_err();
        assert!(err.to_string().contains("Wrong passphrase"));
    }

    #[test]
    fn magic_mismatch_rejects() {
        let mut blob = encrypt(&fixture_payload(), "correct horse battery staple").unwrap();
        blob[0] = b'X';
        let err = decrypt(&blob, "correct horse battery staple").unwrap_err();
        assert!(err.to_string().contains("Not a Statewave"));
    }

    #[test]
    fn header_layout_is_le_u32() {
        let blob = encrypt(&fixture_payload(), "correct horse battery staple").unwrap();
        // bytes 6..10 are the LE u32 header length
        let len = u32::from_le_bytes(blob[6..10].try_into().unwrap()) as usize;
        // header is JSON, so it starts with `{` and ends with `}`
        assert_eq!(blob[10], b'{');
        assert_eq!(blob[10 + len - 1], b'}');
    }

    #[test]
    fn short_passphrase_rejected_on_encrypt() {
        let err = encrypt(&fixture_payload(), "short").unwrap_err();
        assert!(err.to_string().contains("at least 8"));
    }
}

use anyhow::Result;

/// Build a query string from a list of (key, value) pairs. Returns an
/// empty string when `pairs` is empty so callers can append it directly.
pub fn qs(pairs: &[(&str, String)]) -> String {
    if pairs.is_empty() {
        return String::new();
    }
    let mut out = String::from("?");
    for (i, (k, v)) in pairs.iter().enumerate() {
        if i > 0 {
            out.push('&');
        }
        out.push_str(k);
        out.push('=');
        out.push_str(&encode(v));
    }
    out
}

/// RFC-3986 unreserved-character percent encoder.
pub fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

pub fn confirm(prompt: &str) -> Result<bool> {
    Ok(inquire::Confirm::new(prompt)
        .with_default(false)
        .prompt()?)
}

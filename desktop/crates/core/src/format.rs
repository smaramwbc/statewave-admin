//! Output rendering: json | yaml | table.
//!
//! The CLI defaults to `table` for tty stdout and `json` when piped, so
//! humans get a readable view and pipelines get something parseable. The
//! user can always override with `--json` / `--yaml` / `--table`.

use comfy_table::presets::UTF8_FULL_CONDENSED;
use comfy_table::{Cell, ContentArrangement, Table};
use serde_json::Value;
use std::fmt::Write as _;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Json,
    Yaml,
    Table,
}

impl Format {
    pub fn auto(explicit: Option<Format>) -> Format {
        if let Some(f) = explicit {
            return f;
        }
        if std::io::IsTerminal::is_terminal(&std::io::stdout()) {
            Format::Table
        } else {
            Format::Json
        }
    }
}

pub fn render(value: &Value, format: Format) -> String {
    match format {
        Format::Json => serde_json::to_string_pretty(value).unwrap_or_default(),
        Format::Yaml => serde_yaml::to_string(value).unwrap_or_default(),
        Format::Table => render_table(value),
    }
}

/// Render `value` as a table when it has a recognizable list shape:
///   * `{"key": [obj, obj, …], "total": N, ...}` — paginated list
///     (admin endpoints like `/admin/subjects`, `/admin/jobs`)
///   * `[obj, obj, …]` — bare array
/// Otherwise falls back to a key/value dump.
pub fn render_table(value: &Value) -> String {
    if let Value::Array(arr) = value {
        if arr.is_empty() {
            return "(empty)".into();
        }
        return render_object_array(arr);
    }
    match pick_list(value) {
        Some(PickedList::Paginated(arr)) => {
            if arr.is_empty() {
                "(empty)".into()
            } else {
                render_object_array(arr)
            }
        }
        Some(PickedList::Plain(arr)) => render_object_array(arr),
        None => render_object(value),
    }
}

enum PickedList<'a> {
    Paginated(&'a Vec<Value>),
    Plain(&'a Vec<Value>),
}

fn pick_list(value: &Value) -> Option<PickedList<'_>> {
    let obj = value.as_object()?;
    // Paginated list shape: `{ <plural>: [...], total, limit, offset }`.
    // Pick the largest array even if empty so an empty page renders as
    // "(empty)" rather than a kv dump that prints `[] ` in a value cell.
    let has_paginated_meta = obj.contains_key("total")
        || obj.contains_key("limit")
        || obj.contains_key("offset");
    if has_paginated_meta {
        if let Some(arr) = obj
            .values()
            .filter_map(|v| v.as_array())
            .max_by_key(|a| a.len())
        {
            return Some(PickedList::Paginated(arr));
        }
    }
    // No pagination metadata: only treat a non-empty array as the table
    // body. `{"deleted": 4, "failed": []}` correctly falls through to kv.
    obj.values()
        .filter_map(|v| v.as_array())
        .filter(|a| !a.is_empty())
        .max_by_key(|a| a.len())
        .map(PickedList::Plain)
}

fn render_object_array(rows: &[Value]) -> String {
    if rows.is_empty() {
        return "(empty)".into();
    }
    // Union of keys across the first ~50 rows, in insertion order.
    let mut keys: Vec<String> = Vec::new();
    for row in rows.iter().take(50) {
        if let Some(obj) = row.as_object() {
            for k in obj.keys() {
                if !keys.iter().any(|existing| existing == k) {
                    keys.push(k.clone());
                }
            }
        }
    }
    if keys.is_empty() {
        // array of scalars
        let mut out = String::new();
        for v in rows {
            let _ = writeln!(out, "{}", scalar(v));
        }
        return out;
    }
    let mut t = Table::new();
    t.load_style(UTF8_FULL_CONDENSED)
        .set_content_arrangement(ContentArrangement::Dynamic)
        .set_header(keys.iter().map(|k| Cell::new(k)));
    for row in rows {
        let cells: Vec<Cell> = keys
            .iter()
            .map(|k| Cell::new(scalar(row.get(k).unwrap_or(&Value::Null))))
            .collect();
        t.add_row(cells);
    }
    t.to_string()
}

fn render_object(value: &Value) -> String {
    let Some(obj) = value.as_object() else {
        return scalar(value);
    };
    let mut t = Table::new();
    t.load_style(UTF8_FULL_CONDENSED)
        .set_content_arrangement(ContentArrangement::Dynamic)
        .set_header(vec![Cell::new("field"), Cell::new("value")]);
    for (k, v) in obj {
        t.add_row(vec![Cell::new(k), Cell::new(scalar(v))]);
    }
    t.to_string()
}

fn scalar(v: &Value) -> String {
    match v {
        Value::Null => "—".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        Value::Array(_) | Value::Object(_) => {
            let s = serde_json::to_string(v).unwrap_or_default();
            if s.len() > 80 {
                format!("{}…", &s[..80])
            } else {
                s
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_largest_list_in_paginated_response() {
        let v = serde_json::json!({
            "subjects": [{"id": "a"}, {"id": "b"}],
            "total": 2,
            "limit": 50,
            "offset": 0,
        });
        let table = render_table(&v);
        assert!(table.contains("id"));
        assert!(table.contains("a"));
    }

    #[test]
    fn empty_paginated_list_renders_empty() {
        let v = serde_json::json!({ "jobs": [], "total": 0, "limit": 50, "offset": 0 });
        assert_eq!(render_table(&v), "(empty)");
    }

    #[test]
    fn empty_bare_array_renders_empty() {
        let v = serde_json::json!([]);
        assert_eq!(render_table(&v), "(empty)");
    }

    #[test]
    fn falls_back_to_kv_dump() {
        let v = serde_json::json!({"deleted": 4, "failed": []});
        let table = render_table(&v);
        assert!(table.contains("deleted"));
    }
}

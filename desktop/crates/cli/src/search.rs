use crate::index::{CommandEntry, COMMANDS};
use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;

/// Rank every command by fuzzy match against `query`. Higher score first.
pub fn rank(query: &str, limit: usize) -> Vec<(&'static CommandEntry, i64)> {
    let matcher = SkimMatcherV2::default().ignore_case();
    let mut hits: Vec<(&'static CommandEntry, i64)> = COMMANDS
        .iter()
        .filter_map(|c| {
            // Match against label + invocation + description for reach.
            let haystack = format!("{} {} {}", c.label, c.invocation, c.description);
            matcher.fuzzy_match(&haystack, query).map(|s| (c, s))
        })
        .collect();
    hits.sort_by(|a, b| b.1.cmp(&a.1));
    hits.truncate(limit);
    hits
}

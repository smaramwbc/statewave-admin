use anyhow::{anyhow, Result};
use statewave_admin_core::format::Format;
use statewave_admin_core::AdminClient;

use crate::cli::EvalCmd;
use crate::output;

pub async fn run(client: &AdminClient, cmd: EvalCmd, format: Format) -> Result<()> {
    match cmd {
        EvalCmd::Status => {
            let v = client.get_raw("/api/self-healing-eval/status").await?;
            output::print_value(&v, format);
        }
        EvalCmd::Run {
            mode,
            max_level,
            max_questions,
            subject,
        } => {
            let body = serde_json::json!({
                "mode": mode,
                "max_level": max_level,
                "max_questions": max_questions,
                "subject_id": subject,
            });
            let v = client.post_raw("/api/self-healing-eval/run", &body).await?;
            output::print_value(&v, format);
        }
        EvalCmd::Report { format: report_fmt } => {
            // Server supports `?format=markdown` for a rendered report.
            // Print as plain text in that mode rather than wrapping in a
            // table.
            match report_fmt.as_str() {
                "markdown" | "md" => {
                    let v = client
                        .get_raw("/api/self-healing-eval/report/latest?format=markdown")
                        .await?;
                    if let Some(s) = v.as_str() {
                        println!("{s}");
                    } else {
                        // Older servers may return JSON-encoded text.
                        output::print_value(&v, format);
                    }
                }
                "json" | "" => {
                    let v = client
                        .get_raw("/api/self-healing-eval/report/latest")
                        .await?;
                    output::print_value(&v, format);
                }
                other => return Err(anyhow!("unknown report format: {other} (use json | markdown)")),
            }
        }
        EvalCmd::Grounding {
            subject_id,
            max_memories,
        } => {
            let body = serde_json::json!({
                "subject_id": subject_id,
                "max_memories": max_memories,
            });
            let v = client
                .post_raw("/api/self-healing-eval/grounding/suggest", &body)
                .await?;
            output::print_value(&v, format);
        }
    }
    Ok(())
}

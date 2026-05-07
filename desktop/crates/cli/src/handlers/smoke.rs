use anyhow::Result;
use statewave_admin_core::format::Format;
use statewave_admin_core::AdminClient;

use crate::cli::SmokeCmd;
use crate::output;

pub async fn run(client: &AdminClient, cmd: SmokeCmd, format: Format) -> Result<()> {
    match cmd {
        SmokeCmd::Status => {
            let v = client.get_raw("/api/admin/smoke/status").await?;
            output::print_value(&v, format);
        }
        SmokeCmd::Run => {
            let v = client
                .post_raw("/api/admin/smoke/run", &serde_json::json!({}))
                .await?;
            output::print_value(&v, format);
        }
    }
    Ok(())
}

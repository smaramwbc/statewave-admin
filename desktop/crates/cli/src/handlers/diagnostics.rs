use anyhow::Result;
use statewave_admin_core::format::Format;
use statewave_admin_core::AdminClient;

use crate::cli::DiagCmd;
use crate::output;

pub async fn run(client: &AdminClient, cmd: DiagCmd, format: Format) -> Result<()> {
    match cmd {
        DiagCmd::Personas { force } => {
            let path = if force {
                "/api/admin/persona-health?force=true"
            } else {
                "/api/admin/persona-health"
            };
            let v = client.get_raw(path).await?;
            output::print_value(&v, format);
        }
    }
    Ok(())
}

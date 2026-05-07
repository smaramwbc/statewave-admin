use anyhow::Result;
use statewave_admin_core::format::Format;
use statewave_admin_core::AdminClient;

use crate::output;
use crate::util::encode;

pub async fn dashboard(client: &AdminClient, format: Format) -> Result<()> {
    let v = client.proxy_get("/admin/dashboard").await?;
    output::print_value(&v, format);
    Ok(())
}

pub async fn usage(client: &AdminClient, tenant: Option<&str>, format: Format) -> Result<()> {
    let path = match tenant {
        Some(t) => format!("/admin/usage?tenant_id={}", encode(t)),
        None => "/admin/usage".to_string(),
    };
    let v = client.proxy_get(&path).await?;
    output::print_value(&v, format);
    Ok(())
}

pub async fn tenants(client: &AdminClient, format: Format) -> Result<()> {
    let v = client.proxy_get("/admin/tenants").await?;
    output::print_value(&v, format);
    Ok(())
}

use base64::Engine;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct TunnelConfig {
    #[serde(rename = "wsUrl")]
    pub ws_url: String,
    #[serde(rename = "sessionToken")]
    pub session_token: String,
    #[serde(rename = "targetPort")]
    pub target_port: u16,
}

pub fn parse_deep_link(url: &str) -> Result<TunnelConfig, Box<dyn std::error::Error>> {
    // Parse nucleus-helper://tunnel?config=<base64>
    let config_b64 = url
        .split("config=")
        .nth(1)
        .ok_or("Missing config parameter")?;

    let config_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(config_b64)?;

    let config: TunnelConfig = serde_json::from_slice(&config_bytes)?;
    Ok(config)
}

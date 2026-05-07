use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("not signed in — run `statewave-admin auth login` first")]
    NotAuthenticated,

    #[error("server URL is not configured — run `statewave-admin auth login` or set STATEWAVE_ADMIN_URL")]
    NoServerUrl,

    #[error("authentication failed: {0}")]
    AuthFailed(String),

    #[error("server returned {status}: {body}")]
    Server { status: u16, body: String },

    #[error(transparent)]
    Http(#[from] reqwest::Error),

    #[error(transparent)]
    Url(#[from] url::ParseError),

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Json(#[from] serde_json::Error),

    #[error(transparent)]
    Toml(#[from] toml::de::Error),

    #[error("config write failed: {0}")]
    TomlSer(#[from] toml::ser::Error),

    #[error(transparent)]
    Keyring(#[from] keyring::Error),

    #[error(".swmem error: {0}")]
    Swmem(String),

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, Error>;

use std::fmt;

#[derive(Debug, Clone)]
pub enum Error {
    Http(String),
    Json(String),
    Io(String),
    Auth(String),
    Install(String),
    Launch(String),
    Vault(String),
    NotFound(String),
    Canceled,
    InvalidInput(String),
}

impl Error {
    pub fn invalid(msg: impl Into<String>) -> Self {
        Error::InvalidInput(msg.into())
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Http(m) => write!(f, "Network error: {m}"),
            Error::Json(m) => write!(f, "Invalid data: {m}"),
            Error::Io(m) => write!(f, "File error: {m}"),
            Error::Auth(m) => write!(f, "Authentication error: {m}"),
            Error::Install(m) => write!(f, "Installation error: {m}"),
            Error::Launch(m) => write!(f, "Launch error: {m}"),
            Error::Vault(m) => write!(f, "Secure storage error: {m}"),
            Error::NotFound(m) => write!(f, "Not found: {m}"),
            Error::Canceled => write!(f, "Canceled"),
            Error::InvalidInput(m) => write!(f, "Invalid input: {m}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<reqwest::Error> for Error {
    fn from(e: reqwest::Error) -> Self {
        Error::Http(e.to_string())
    }
}
impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::Json(e.to_string())
    }
}
impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

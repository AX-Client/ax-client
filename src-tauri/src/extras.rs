use crate::discord::DiscordRpc;

/// Globally owned non-persistent services (Discord Rich Presence).
pub struct Extras {
    pub discord: DiscordRpc,
}

impl Default for Extras {
    fn default() -> Self {
        Extras {
            discord: DiscordRpc::new(),
        }
    }
}
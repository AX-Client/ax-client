-- The launcher identifies users by their Minecraft UUID (stable and always
-- present; the Xbox XUID is not reliably returned by Microsoft).
alter table ax_users add column mc_uuid text;

create unique index ax_users_mc_uuid_key on ax_users (mc_uuid);

-- AX Client: user email for admin grant-by-email + identity linking.
-- Emails come from the Microsoft account during sign-in (identify payload).

alter table public.ax_users
  add column if not exists email text;

create unique index if not exists ax_users_email_idx on public.ax_users (email) where email is not null and email <> '';

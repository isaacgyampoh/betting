-- Native Android push registrations (Firebase Cloud Messaging).
--
-- Additive only. push_subscriptions is untouched: that is Web Push for the marketing site, which
-- keeps working exactly as it does now. A phone cannot produce a Web Push subscription and FCM
-- cannot deliver to one, so the two live side by side.
create table if not exists device_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  -- The token is the identity of an install, not of a sign-in. Unique, so re-registering after a
  -- different user signs in moves the row rather than creating a second one - which is what stops
  -- a shared phone inheriting the previous user's alerts.
  token      text not null unique,
  platform   text not null default 'android',
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists device_tokens_user_id_idx on device_tokens (user_id);
create index if not exists device_tokens_revoked_at_idx on device_tokens (revoked_at);

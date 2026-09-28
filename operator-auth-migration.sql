-- REFERENCE ONLY: owner reports this schema ALREADY APPLIED. DO NOT rerun or execute.
-- Included solely for code review against the existing Supabase 2 project.
-- No public registration/first-user bootstrap/role metadata can grant permission.
begin;
create table public.agy_operator_grants (
  user_id uuid not null references auth.users(id) on delete cascade,
  application text not null default 'agy-ide' check (application = 'agy-ide'),
  scopes text[] not null check (cardinality(scopes) between 1 and 2
    and scopes <@ array['memory.read','execution.propose']::text[]
    and array_position(scopes, null) is null),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  granted_by text not null check (length(granted_by) between 3 and 200),
  reason text not null check (length(reason) between 3 and 500),
  created_at timestamptz not null default now(),
  primary key (user_id, application)
);
create table public.agy_operator_sessions (
  id_hash text primary key check (id_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  application text not null default 'agy-ide' check (application = 'agy-ide'),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  csrf_hash text not null check (csrf_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.agy_operator_sessions (user_id);
create table public.agy_operator_audit (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  action text not null check (action in ('grant','revoke')),
  administrator text not null,
  reason text not null,
  created_at timestamptz not null default now()
);
alter table public.agy_operator_grants enable row level security;
alter table public.agy_operator_grants force row level security;
alter table public.agy_operator_sessions enable row level security;
alter table public.agy_operator_sessions force row level security;
alter table public.agy_operator_audit enable row level security;
alter table public.agy_operator_audit force row level security;
revoke all on public.agy_operator_grants, public.agy_operator_sessions, public.agy_operator_audit from public, anon, authenticated;
revoke all on sequence public.agy_operator_audit_id_seq from public, anon, authenticated, service_role;
-- Reset inherited/default table privileges before granting the exact minimum.
revoke all on public.agy_operator_grants, public.agy_operator_sessions, public.agy_operator_audit from service_role;
grant select on public.agy_operator_grants to service_role;
grant select, insert, update on public.agy_operator_sessions to service_role;
commit;

-- PRIVILEGED OFFLINE ADMINISTRATOR TEMPLATE — NOT executable until placeholders
-- are deliberately replaced. Obtain verified auth.users.id from the provider,
-- never from self-supplied profile metadata, email alone or app URL.
-- begin;
-- with granted as (
-- insert into public.agy_operator_grants(user_id,scopes,expires_at,granted_by,reason)
-- select id, array['memory.read'], now()+interval '30 days',
--        '<administrator>', '<approved reason>'
-- from auth.users where id = '<verified-user-uuid>'::uuid and email_confirmed_at is not null
-- on conflict (user_id,application) do update set scopes=excluded.scopes,
--   expires_at=excluded.expires_at, revoked_at=null, granted_by=excluded.granted_by, reason=excluded.reason
-- returning user_id, granted_by, reason
-- )
-- insert into public.agy_operator_audit(user_id,action,administrator,reason)
-- select user_id, 'grant', granted_by, reason from granted;
-- commit;
--
-- SEPARATE PROPOSAL GRANT — BLOCKED, NOT APPROVED FOR EXECUTION.
-- Real-access evidence must first demonstrate stored=false AND dispatched=false
-- and verify absence of mission writes/dispatches, followed by explicit approval.
-- Simulated tests do not satisfy this prerequisite. No such evidence exists yet.
-- Even uncommenting this whole transaction leaves it blocked by the exception.
-- Do not remove the guard until the evidence and separate approval are reviewed.
-- begin;
-- do $$ begin
--   raise exception 'BLOCKED: real no-storage/no-dispatch verification and separate approval required';
-- end $$;
-- with granted as (
-- update public.agy_operator_grants g
-- set scopes=array['memory.read','execution.propose']::text[],
--     granted_by='<administrator>',
--     reason='<explicit proposal approval and real verification reference>'
-- where g.user_id='<verified-user-uuid>'::uuid
--   and g.application='agy-ide' and g.revoked_at is null
--   and g.expires_at>now() and g.scopes=array['memory.read']::text[]
--   and exists (select 1 from auth.users u
--               where u.id=g.user_id and u.email_confirmed_at is not null)
-- returning user_id, granted_by, reason
-- )
-- insert into public.agy_operator_audit(user_id,action,administrator,reason)
-- select user_id, 'grant', granted_by, reason from granted;
-- commit;
--
-- REVOKE (also invalidates every existing browser session durably):
-- Audit once per affected user, only when a grant or session changes.
-- Repeating this after all rows are revoked creates no audit entry.
-- begin;
-- with revoked_grants as (
--   update public.agy_operator_grants set revoked_at=now()
--   where user_id='<verified-user-uuid>'::uuid
--     and application='agy-ide' and revoked_at is null
--   returning user_id
-- ), revoked_sessions as (
--   update public.agy_operator_sessions set revoked_at=now()
--   where user_id='<verified-user-uuid>'::uuid
--     and application='agy-ide' and revoked_at is null
--   returning user_id
-- ), affected_users as (
--   select user_id from revoked_grants
--   union
--   select user_id from revoked_sessions
-- )
-- insert into public.agy_operator_audit(user_id,action,administrator,reason)
-- select user_id,'revoke','<administrator>','<approved reason>'
-- from affected_users;
-- commit;
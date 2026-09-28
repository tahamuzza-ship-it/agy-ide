-- REFERENCE ONLY: owner reports schema ALREADY APPLIED. DO NOT execute or rerun.
-- One read-only catalog statement, preserved for code review only.
-- Intended project: Supabase 2, lxlcivzuevowckbcxczc.
-- Select that project explicitly in SQL Editor; current_database() is not
-- proof of the Supabase project reference.
with expected(name, expected_type) as (
  values
    ('agy_operator_grants', 'table'),
    ('agy_operator_sessions', 'table'),
    ('agy_operator_audit', 'table'),
    ('agy_operator_grants_pkey', 'index'),
    ('agy_operator_sessions_pkey', 'index'),
    ('agy_operator_audit_pkey', 'index'),
    ('agy_operator_sessions_user_id_idx', 'index'),
    ('agy_operator_audit_id_seq', 'sequence')
),
targets as (
  select c.oid
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join expected e on e.name = c.relname and e.expected_type = 'table'
  where n.nspname = 'public'
),
related as (
  select i.indexrelid as oid
  from pg_catalog.pg_index i
  join targets t on t.oid = i.indrelid
  union
  select d.objid
  from pg_catalog.pg_depend d
  join targets t on t.oid = d.refobjid
  join pg_catalog.pg_class s on s.oid = d.objid and s.relkind = 'S'
  where d.classid = 'pg_catalog.pg_class'::regclass
    and d.refclassid = 'pg_catalog.pg_class'::regclass
    and d.deptype in ('a', 'i')
),
objects as (
  select 'public'::text as schema_name, name, expected_type
  from expected
  union
  select n.nspname::text, c.relname::text,
         case when c.relkind = 'S' then 'sequence' else 'index' end
  from related r
  join pg_catalog.pg_class c on c.oid = r.oid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
)
select current_database() as database_name,
       o.schema_name, o.name, o.expected_type,
       c.oid is not null as exists_in_catalog,
       case
         when c.oid is null then 'absent'
         when c.relkind in ('r', 'p') then 'table'
         when c.relkind in ('i', 'I') then 'index'
         when c.relkind = 'S' then 'sequence'
         when c.relkind = 'v' then 'view'
         when c.relkind = 'm' then 'materialized_view'
         when c.relkind = 'f' then 'foreign_table'
         else c.relkind::text
       end as actual_type,
       case when c.relkind in ('i', 'I')
            then pg_catalog.pg_get_indexdef(c.oid)
       end as index_definition
from objects o
left join pg_catalog.pg_namespace n on n.nspname = o.schema_name
left join pg_catalog.pg_class c
  on c.relnamespace = n.oid and c.relname = o.name
order by o.schema_name, o.name;
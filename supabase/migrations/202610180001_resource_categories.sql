-- Additive update: existing records and their categories are preserved.
begin;
do $$ begin
if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'farm_settings' and column_name = 'resource_categories') then
alter table public.farm_settings
  add column if not exists resource_categories text[] not null default '{일반}';
-- Use Korean default; keep all categories already used, including trashed records.
update public.farm_settings
set resource_categories = array(
  select distinct category from (
    select '일반' as category
    union all
    select category from public.entries where kind = 'resource' and trim(category) <> ''
    union all
    select unnest(resource_categories)
  ) categories order by category
);
end if;
end $$;

create or replace function public.save_resource_categories(p_version integer, p_categories text[])
returns void language plpgsql security definer set search_path = public as $$
declare normalized text[];
begin
  if my_role() is distinct from 'admin' then
    raise exception '관리자 권한이 필요합니다';
  end if;
  if p_categories is null or cardinality(p_categories) not between 1 and 100
     or exists(select 1 from unnest(p_categories) c where c is null or length(trim(c)) not between 1 and 50) then
    raise exception '분류는 1~50자로, 1~100개를 입력해 주세요';
  end if;
  select array_agg(c order by first_position) into normalized from (
    select trim(value) c, min(position) first_position
    from unnest(p_categories) with ordinality as items(value, position)
    group by trim(value)
  ) cleaned;
  update farm_settings set resource_categories = normalized, version = version + 1
  where version = p_version;
  if not found then
    raise exception '설정이 변경되었습니다. 새로고침해 주세요' using errcode = 'PT409';
  end if;
end $$;
revoke all on function public.save_resource_categories(integer,text[]) from public, anon;
grant execute on function public.save_resource_categories(integer,text[]) to authenticated;
notify pgrst, 'reload schema';
commit;

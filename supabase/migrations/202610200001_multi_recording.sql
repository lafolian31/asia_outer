-- Preserve legacy values; arrays are populated only when users save multi selections.
begin;
alter table public.entries
 add column if not exists work_groups text[],
 add column if not exists work_items jsonb,
 add column if not exists crop_names text[],
 add column if not exists zone_names text[],
 add column if not exists plan_ids uuid[];
alter table public.farm_settings add column if not exists multi_recording boolean not null default true;

create table if not exists public.entry_plan_links (
 entry_id uuid not null references public.entries(id) on delete cascade,
 plan_id uuid not null references public.entries(id) on delete restrict,
 primary key(entry_id,plan_id)
);
create index if not exists entry_plan_links_plan on public.entry_plan_links(plan_id);
alter table public.entry_plan_links enable row level security;
drop policy if exists entry_plan_links_read on public.entry_plan_links;
create policy entry_plan_links_read on public.entry_plan_links for select to authenticated using(
 my_role() is not null and exists(select 1 from entries e where e.id=entry_id and (e.deleted_at is null or my_role()='admin'))
);
revoke all on public.entry_plan_links from anon,authenticated;
grant select on public.entry_plan_links to authenticated;
create or replace function public.sync_entry_plan_links() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 delete from entry_plan_links where entry_id=new.id;
 if new.kind='log' then
   insert into entry_plan_links(entry_id,plan_id)
   select new.id,p from unnest(coalesce(new.plan_ids,case when new.plan_id is null then '{}'::uuid[] else array[new.plan_id] end)) p group by p;
 end if;
 return new;
end $$;
revoke all on function public.sync_entry_plan_links() from public,anon,authenticated;
drop trigger if exists sync_entry_plan_links on public.entries;
create trigger sync_entry_plan_links after insert or update of plan_id,plan_ids on public.entries for each row execute function public.sync_entry_plan_links();
insert into public.entry_plan_links(entry_id,plan_id)
 select e.id,p from entries e cross join lateral unnest(coalesce(e.plan_ids,case when e.plan_id is null then '{}'::uuid[] else array[e.plan_id] end)) p where e.kind='log' on conflict do nothing;

create or replace function public.save_entry(p_id uuid,p_version integer,p_data jsonb) returns public.entries
language plpgsql security definer set search_path=public as $$
declare old entries; item entries; v_kind text;
begin
 if coalesce(my_role() in ('admin','editor'),false)=false then raise exception '작성 권한이 없습니다'; end if;
 -- Serialize creation and updates, including retries carrying the same id.
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into old from entries where id=p_id for update;
 if found then
  if not can_edit(old.author_id) or old.deleted_at is not null then raise exception '수정 권한이 없습니다'; end if;
  if old.version<>p_version then raise exception '다른 변경이 있습니다. 최신 기록을 다시 열어 주세요' using errcode='PT409'; end if;
  v_kind=old.kind;
 else
  if p_version<>0 then raise exception '기록이 존재하지 않습니다'; end if;
  v_kind=p_data->>'kind';
 end if;
 item:=jsonb_populate_record(null::entries,p_data);
 item.id=p_id; item.kind=v_kind; item.title=trim(item.title); item.body=coalesce(item.body,'');
 item.status=coalesce(item.status,'미실행'); item.result=coalesce(item.result,''); item.zone=coalesce(item.zone,'');
 item.crop=coalesce(item.crop,''); item.category=coalesce(item.category,'일반'); item.url=coalesce(item.url,'');
 item.record_type=case when item.kind='log' then coalesce(item.record_type,old.record_type) else null end;
 item.work_group=coalesce(item.work_group,old.work_group,''); item.work_task=coalesce(item.work_task,old.work_task,'');
 item.activity_category=coalesce(item.activity_category,old.activity_category,'');
 if not (p_data ? 'quantity') then item.quantity=old.quantity; end if;
 item.quantity_unit=coalesce(item.quantity_unit,old.quantity_unit,''); item.participant_ids=coalesce(item.participant_ids,old.participant_ids,'{}');
 if p_version is null or length(item.work_group)>80 or length(item.work_task)>100 or length(item.quantity_unit)>30
    or cardinality(item.participant_ids)>100 then raise exception '작업 항목을 확인해 주세요'; end if;
 if item.record_type='activity' and item.activity_category not in ('회의·운영','교육·견학','행사·교류','판매·홍보','나눔·봉사','자재·행정') then raise exception '운영·교류 분류를 선택해 주세요'; end if;
 if exists(select 1 from unnest(item.participant_ids) p where p is null or not exists(select 1 from members m where m.user_id=p and (m.active or p=any(coalesce(old.participant_ids,'{}'))))) then raise exception '참여자를 확인해 주세요'; end if;
 if item.kind='log' and (item.title is null or item.title='') then
   item.title=concat_ws(' · ',nullif(item.crop,''),coalesce(case when item.record_type='activity' then nullif(item.activity_category,'') else coalesce(nullif(item.work_task,''),nullif(item.work_group,'')) end,'사진 기록'));
 end if;
 -- Missing multi-value properties from older clients preserve existing selections.
 item.work_groups=case when p_data ? 'work_groups' then item.work_groups else old.work_groups end;
 item.work_items=case when p_data ? 'work_items' then item.work_items else old.work_items end;
 item.crop_names=case when p_data ? 'crop_names' then item.crop_names else old.crop_names end;
 item.zone_names=case when p_data ? 'zone_names' then item.zone_names else old.zone_names end;
 item.plan_ids=case when p_data ? 'plan_ids' then item.plan_ids else old.plan_ids end;
 if item.work_groups is not null then
   if cardinality(item.work_groups)>30 or exists(select 1 from unnest(item.work_groups) x where x is null or length(trim(x)) not between 1 and 80) then raise exception '대분류 선택을 확인해 주세요'; end if;
   select coalesce(array_agg(value order by pos),'{}') into item.work_groups from (select trim(x) value,min(n) pos from unnest(item.work_groups) with ordinality t(x,n) group by trim(x)) d;
   item.work_group=coalesce(item.work_groups[1],'');
 end if;
 if item.work_items is not null then
   if jsonb_typeof(item.work_items)<>'array' then raise exception '세부작업 선택을 확인해 주세요'; end if;
   if jsonb_array_length(item.work_items)>100 then raise exception '세부작업은 최대 100개입니다'; end if;
   if exists(select 1 from jsonb_array_elements(item.work_items) w where jsonb_typeof(w)<>'object'
     or jsonb_typeof(w->'group') is distinct from 'string' or jsonb_typeof(w->'task') is distinct from 'string'
     or length(trim(w->>'group')) not between 0 and 80 or length(trim(w->>'task')) not between 1 and 100
     or not (trim(w->>'group')='' or trim(w->>'group')=any(coalesce(item.work_groups,array[item.work_group])))) then raise exception '선택한 대분류의 세부작업을 확인해 주세요'; end if;
   select coalesce(jsonb_agg(w order by pos),'[]') into item.work_items from (select jsonb_build_object('group',trim(v->>'group'),'task',trim(v->>'task')) w,min(n) pos from jsonb_array_elements(item.work_items) with ordinality t(v,n) group by jsonb_build_object('group',trim(v->>'group'),'task',trim(v->>'task'))) d;
   item.work_task=coalesce(item.work_items->0->>'task','');
 end if;
 if item.crop_names is not null then
   if cardinality(item.crop_names)>100 or exists(select 1 from unnest(item.crop_names) x where x is null or length(trim(x)) not between 1 and 80) then raise exception '작물 선택을 확인해 주세요'; end if;
   select coalesce(array_agg(value order by pos),'{}') into item.crop_names from (select trim(x) value,min(n) pos from unnest(item.crop_names) with ordinality t(x,n) group by trim(x)) d;
   item.crop=coalesce(item.crop_names[1],'');
 end if;
 if item.zone_names is not null then
   if cardinality(item.zone_names)>100 or exists(select 1 from unnest(item.zone_names) x where x is null or length(trim(x)) not between 1 and 80) then raise exception '장소 선택을 확인해 주세요'; end if;
   select coalesce(array_agg(value order by pos),'{}') into item.zone_names from (select trim(x) value,min(n) pos from unnest(item.zone_names) with ordinality t(x,n) group by trim(x)) d;
   item.zone=coalesce(item.zone_names[1],'');
 end if;
 if item.plan_ids is not null then
   if item.kind<>'log' or cardinality(item.plan_ids)>100 or exists(select 1 from unnest(item.plan_ids) p where p is null or not exists(select 1 from entries where id=p and kind='plan' and deleted_at is null)) then raise exception '연결할 계획을 확인해 주세요'; end if;
   select coalesce(array_agg(value order by pos),'{}') into item.plan_ids from (select x value,min(n) pos from unnest(item.plan_ids) with ordinality t(x,n) group by x) d;
   item.plan_id=item.plan_ids[1];
 end if;
 if item.kind='log' and coalesce(trim(p_data->>'title'),'')='' and (item.crop_names is not null or item.work_items is not null) then
   item.title=left(concat_ws(' · ',nullif(array_to_string(coalesce(item.crop_names,array[nullif(item.crop,'')]),', '),''),coalesce(nullif((select string_agg(w->>'task',', ' order by n) from jsonb_array_elements(coalesce(item.work_items,'[]')) with ordinality t(w,n)),''),nullif(array_to_string(item.work_groups,', '),''),'사진 기록')),160);
 end if;
 item.author_id=coalesce(old.author_id,auth.uid()); item.created_at=coalesce(old.created_at,now());
 item.updated_at=now(); item.updated_by=auth.uid(); item.version=coalesce(old.version,0)+1;
 item.deleted_at=null; item.deleted_by=null;
 if item.kind='log' and item.plan_id is not null and not exists(select 1 from entries where id=item.plan_id and kind='plan' and deleted_at is null) then raise exception '연결할 계획이 없습니다'; end if;
 if item.assignee is not null and not exists(select 1 from members where user_id=item.assignee and active) then raise exception '담당자를 확인해 주세요'; end if;
 if item.kind='plan' and item.status='완료' then
  if old.status is distinct from '완료' or old.actual_date is distinct from item.actual_date or old.result is distinct from item.result then
   item.completed_at=now(); item.completed_by=auth.uid();
  else item.completed_at=old.completed_at; item.completed_by=old.completed_by; end if;
 else item.completed_at=null; item.completed_by=null; end if;
 if old.id is null then insert into entries select item.*;
 else update entries set work_groups=item.work_groups,work_items=item.work_items,crop_names=item.crop_names,zone_names=item.zone_names,plan_ids=item.plan_ids,record_type=item.record_type,work_group=item.work_group,work_task=item.work_task,activity_category=item.activity_category,quantity=item.quantity,quantity_unit=item.quantity_unit,participant_ids=item.participant_ids,title=item.title,body=item.body,work_date=item.work_date,target_year=item.target_year,start_date=item.start_date,end_date=item.end_date,status=item.status,actual_date=item.actual_date,result=item.result,zone=item.zone,crop=item.crop,assignee=item.assignee,plan_id=item.plan_id,category=item.category,url=item.url,updated_at=item.updated_at,updated_by=item.updated_by,version=item.version,completed_at=item.completed_at,completed_by=item.completed_by where id=p_id; end if;
 return item;
end $$;

create or replace function public.purge_entry(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if my_role() is distinct from 'admin' then raise exception '관리자 권한이 필요합니다'; end if;
 perform 1 from entries where id=p_id and deleted_at is not null for update;
 if not found then raise exception '휴지통 항목만 영구 삭제할 수 있습니다'; end if;
 if exists(select 1 from entries where plan_id=p_id) or exists(select 1 from entry_plan_links where plan_id=p_id) then raise exception '연결된 일지가 있어 계획을 영구 삭제할 수 없습니다'; end if;
 if exists(select 1 from assets a join storage.objects o on o.bucket_id='farm-files' and o.name=a.path where a.entry_id=p_id) then raise exception '첨부파일을 먼저 삭제해야 합니다'; end if;
 delete from assets where entry_id=p_id;
 delete from entries where id=p_id;
end $$;
revoke all on function public.save_entry(uuid,integer,jsonb),public.purge_entry(uuid) from public,anon;
grant execute on function public.save_entry(uuid,integer,jsonb),public.purge_entry(uuid) to authenticated;
notify pgrst,'reload schema';
commit;

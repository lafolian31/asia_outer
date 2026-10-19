-- Additive selection fields; existing entry classification remains empty.
begin;
alter table public.entries
  add column if not exists record_type text check(record_type in ('farm','activity')),
  add column if not exists work_group text not null default '',
  add column if not exists work_task text not null default '',
  add column if not exists activity_category text not null default '',
  add column if not exists quantity numeric check(quantity >= 0 and quantity < 1000000000),
  add column if not exists quantity_unit text not null default '',
  add column if not exists participant_ids uuid[] not null default '{}';
-- Remove only the original requirement for a nonempty log body, keeping its date requirement.
do $$ declare item record; begin
  for item in select conname from pg_constraint where conrelid='public.entries'::regclass
    and contype='c' and pg_get_constraintdef(oid) like '%work_date%' and pg_get_constraintdef(oid) like '%body%'
  loop execute format('alter table public.entries drop constraint %I',item.conname); end loop;
  if not exists(select 1 from pg_constraint where conrelid='public.entries'::regclass and conname='log_work_date_required') then
    alter table public.entries add constraint log_work_date_required check(kind<>'log' or work_date is not null);
  end if;
end $$;
alter table public.farm_settings add column if not exists work_catalog jsonb not null default '{"재배준비·심기": ["경운", "두둑 만들기", "멀칭", "육묘", "파종", "정식", "보식"], "물·양분 관리": ["관수", "배수", "퇴비 주기", "밑거름", "웃거름", "액비"], "생육관리": ["솎기", "순지르기", "가지치기", "유인", "지주 설치", "적화·적과"], "잡초·병해충": ["제초", "병해충 예찰", "방제", "피해 조사"], "수확·수확 후": ["수확", "탈곡", "선별", "세척", "건조", "저장", "포장"], "시설·환경": ["하우스 환기", "온습도 조절", "차광", "보온", "시설 수리"], "관찰·점검": ["생육 관찰", "발아 확인", "토양 상태", "병징 관찰", "사진 기록"], "기타 농작업": []}'::jsonb;

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
 else update entries set record_type=item.record_type,work_group=item.work_group,work_task=item.work_task,activity_category=item.activity_category,quantity=item.quantity,quantity_unit=item.quantity_unit,participant_ids=item.participant_ids,title=item.title,body=item.body,work_date=item.work_date,target_year=item.target_year,start_date=item.start_date,end_date=item.end_date,status=item.status,actual_date=item.actual_date,result=item.result,zone=item.zone,crop=item.crop,assignee=item.assignee,plan_id=item.plan_id,category=item.category,url=item.url,updated_at=item.updated_at,updated_by=item.updated_by,version=item.version,completed_at=item.completed_at,completed_by=item.completed_by where id=p_id; end if;
 return item;
end $$;

create or replace function public.save_work_catalog(p_version integer,p_catalog jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare grp record;
begin
 if my_role() is distinct from 'admin' then raise exception '관리자 권한이 필요합니다'; end if;
 if p_catalog is null or jsonb_typeof(p_catalog)<>'object' then raise exception '작업 목록을 확인해 주세요'; end if;
 if (select count(*) from jsonb_object_keys(p_catalog)) not between 1 and 30 then raise exception '대분류는 1~30개입니다'; end if;
 for grp in select * from jsonb_each(p_catalog) loop
   if length(trim(grp.key)) not between 1 and 80 or jsonb_typeof(grp.value)<>'array' then raise exception '작업 목록을 확인해 주세요'; end if;
   if jsonb_array_length(grp.value)>100 then raise exception '세부작업은 분류당 최대 100개입니다'; end if;
   if exists(select 1 from jsonb_array_elements(grp.value) v where jsonb_typeof(v)<>'string' or length(trim(v#>>'{}')) not between 1 and 100) then raise exception '세부작업 이름을 확인해 주세요'; end if;
 end loop;
 update farm_settings set work_catalog=p_catalog,version=version+1 where version=p_version;
 if not found then raise exception '설정이 변경되었습니다. 새로고침해 주세요' using errcode='PT409'; end if;
end $$;
create or replace function public.add_crop(p_crop text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if coalesce(my_role() in ('admin','editor'),false)=false then raise exception '작물 등록 권한이 없습니다'; end if;
 if p_crop is null or length(trim(p_crop)) not between 1 and 80 then raise exception '작물 이름을 확인해 주세요'; end if;
 perform 1 from farm_settings for update;
 if exists(select 1 from farm_settings where trim(p_crop)=any(crops)) then return; end if;
 if exists(select 1 from farm_settings where cardinality(crops)>=100) then raise exception '작물은 최대 100개입니다'; end if;
 update farm_settings set crops=array_append(crops,trim(p_crop)),version=version+1;
end $$;
revoke all on function public.save_entry(uuid,integer,jsonb),public.save_work_catalog(integer,jsonb),public.add_crop(text) from public,anon;
grant execute on function public.save_entry(uuid,integer,jsonb),public.save_work_catalog(integer,jsonb),public.add_crop(text) to authenticated;
notify pgrst,'reload schema';
commit;

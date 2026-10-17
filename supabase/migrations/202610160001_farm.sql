-- Single-farm application. All application writes go through checked RPCs.
create extension if not exists pgcrypto with schema extensions;
create type public.farm_role as enum ('admin','editor','viewer');
create table public.farm_settings (
 id boolean primary key default true check (id), name text not null default '우리 농장 (임시 이름)',
 zones text[] not null default '{}', crops text[] not null default '{}', version integer not null default 1
);
insert into public.farm_settings(id) values(true);
create table public.members (
 user_id uuid primary key references auth.users(id), display_name text not null check(length(display_name) between 1 and 80),
 role public.farm_role not null default 'editor', active boolean not null default true,
 created_at timestamptz not null default now()
);
create table public.entries (
 id uuid primary key, kind text not null check(kind in ('log','plan','resource')),
 title text not null check(length(trim(title)) between 1 and 160), body text not null default '' check(length(body)<=20000),
 work_date date, target_year integer check(target_year between 2000 and 2200), start_date date, end_date date,
 status text not null default '미실행' check(status in ('미실행','진행중','완료','보류','취소')),
 actual_date date, result text not null default '', zone text not null default '', crop text not null default '',
 assignee uuid references public.members(user_id), plan_id uuid references public.entries(id),
 category text not null default '일반', url text not null default '',
 author_id uuid not null references public.members(user_id), created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), updated_by uuid references auth.users(id),
 completed_at timestamptz, completed_by uuid references auth.users(id),
 deleted_at timestamptz, deleted_by uuid references auth.users(id), version integer not null default 1,
 check(kind <> 'log' or (work_date is not null and length(trim(body))>0)),
 check(kind <> 'plan' or (target_year is not null and start_date is not null and end_date is not null and end_date>=start_date)),
 check(kind <> 'plan' or status <> '완료' or (actual_date is not null and length(trim(result))>0)),
 check(kind = 'log' or plan_id is null), check(length(url)<=2000 and (url='' or url ~ '^https?://'))
);
create index entries_plan on public.entries(plan_id);
create index entries_dates on public.entries(kind, work_date, target_year);
create table public.assets (
 id uuid primary key default gen_random_uuid(), entry_id uuid not null references public.entries(id),
 path text unique not null, name text not null, mime text not null, size bigint not null check(size>0 and size<=10485760),
 author_id uuid not null references public.members(user_id), ready boolean not null default false,
 created_at timestamptz not null default now(), deleted_at timestamptz
);
create index assets_entry on public.assets(entry_id);
create table public.invitations (
 id uuid primary key default gen_random_uuid(), email text not null, token_hash text not null unique,
 role public.farm_role not null check(role <> 'admin'), expires_at timestamptz not null default now()+interval '7 days',
 created_by uuid not null references auth.users(id), used_at timestamptz, used_by uuid references auth.users(id)
);
create table public.audit_log (
 id bigint generated always as identity primary key, entity text not null, entity_id text not null,
 action text not null, actor_id uuid, at timestamptz not null default now()
);
create function public.my_role() returns public.farm_role language sql stable security definer set search_path=public
as $$ select role from members where user_id=auth.uid() and active $$;
create function public.can_edit(p_author uuid) returns boolean language sql stable security definer set search_path=public
as $$ select coalesce(my_role()='admin' or (my_role()='editor' and auth.uid()=p_author),false) $$;
create function public.record_audit() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into audit_log(entity,entity_id,action,actor_id) values(TG_TABLE_NAME,
 coalesce(to_jsonb(NEW)->>'id',to_jsonb(NEW)->>'user_id',to_jsonb(OLD)->>'id',to_jsonb(OLD)->>'user_id','settings'),TG_OP,auth.uid());
 return coalesce(NEW,OLD);
end $$;
create trigger entry_audit after insert or update or delete on public.entries for each row execute function public.record_audit();
create trigger member_audit after insert or update or delete on public.members for each row execute function public.record_audit();
create trigger asset_audit after insert or update or delete on public.assets for each row execute function public.record_audit();
create trigger settings_audit after update on public.farm_settings for each row execute function public.record_audit();
create trigger invitation_audit after insert or update on public.invitations for each row execute function public.record_audit();
alter table public.farm_settings enable row level security;
alter table public.members enable row level security;
alter table public.entries enable row level security;
alter table public.assets enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_log enable row level security;
create policy settings_read on public.farm_settings for select to authenticated using(my_role() is not null);
create policy members_read on public.members for select to authenticated using(my_role() is not null);
create policy entries_read on public.entries for select to authenticated using(my_role() is not null and (deleted_at is null or my_role()='admin'));
create policy assets_read on public.assets for select to authenticated using(my_role() is not null and exists(select 1 from entries e where e.id=entry_id) and (deleted_at is null or my_role()='admin'));
create policy audit_read on public.audit_log for select to authenticated using(my_role()='admin');

create function public.save_entry(p_id uuid,p_version integer,p_data jsonb) returns public.entries
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
 else update entries set title=item.title,body=item.body,work_date=item.work_date,target_year=item.target_year,start_date=item.start_date,end_date=item.end_date,status=item.status,actual_date=item.actual_date,result=item.result,zone=item.zone,crop=item.crop,assignee=item.assignee,plan_id=item.plan_id,category=item.category,url=item.url,updated_at=item.updated_at,updated_by=item.updated_by,version=item.version,completed_at=item.completed_at,completed_by=item.completed_by where id=p_id; end if;
 return item;
end $$;

create function public.trash_entry(p_id uuid,p_version integer,p_restore boolean default false) returns void
language plpgsql security definer set search_path=public as $$
declare e entries;
begin
 select * into e from entries where id=p_id for update;
 if not found or not can_edit(e.author_id) or (p_restore and my_role()<>'admin') then raise exception '권한이 없습니다'; end if;
 if e.version<>p_version then raise exception '다른 변경이 있습니다. 새로고침해 주세요' using errcode='PT409'; end if;
 update entries set deleted_at=case when p_restore then null else now() end,deleted_by=case when p_restore then null else auth.uid() end,updated_at=now(),updated_by=auth.uid(),version=version+1 where id=p_id;
end $$;

create function public.update_member(p_user uuid,p_role public.farm_role,p_active boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(73001);
 if my_role() is distinct from 'admin' then raise exception '관리자 권한이 필요합니다'; end if;
 if exists(select 1 from members where user_id=p_user and role='admin' and active) and (p_role<>'admin' or not p_active) and (select count(*) from members where role='admin' and active)<=1 then raise exception '마지막 관리자는 해제할 수 없습니다'; end if;
 update members set role=p_role,active=p_active where user_id=p_user;
 if not found then raise exception '참여자가 없습니다'; end if;
end $$;
create function public.save_settings(p_version integer,p_name text,p_zones text[],p_crops text[]) returns void
language plpgsql security definer set search_path=public as $$
begin
 if my_role() is distinct from 'admin' then raise exception '관리자 권한이 필요합니다'; end if;
 if length(trim(p_name)) not between 1 and 100 or cardinality(p_zones)>100 or cardinality(p_crops)>100 then raise exception '설정을 확인해 주세요'; end if;
 update farm_settings set name=trim(p_name),zones=p_zones,crops=p_crops,version=version+1 where version=p_version;
 if not found then raise exception '설정이 변경되었습니다. 새로고침해 주세요' using errcode='PT409'; end if;
end $$;
create function public.create_invitation(p_email text,p_role public.farm_role default 'editor') returns text
language plpgsql security definer set search_path=public,extensions as $$
declare token text:=encode(gen_random_bytes(24),'hex');
begin
 if my_role() is distinct from 'admin' then raise exception '관리자 권한이 필요합니다'; end if;
 if p_role='admin' or p_email !~ '^[^ @]+@[^ @]+\.[^ @]+$' then raise exception '초대 정보를 확인해 주세요'; end if;
 insert into invitations(email,token_hash,role,created_by) values(lower(trim(p_email)),encode(digest(token,'sha256'),'hex'),p_role,auth.uid());
 return token;
end $$;
create function public.accept_invitation(p_token text,p_name text) returns void
language plpgsql security definer set search_path=public,extensions as $$
declare inv invitations; mail text;
begin
 if auth.uid() is null or length(trim(p_name)) not between 1 and 80 then raise exception '로그인과 이름이 필요합니다'; end if;
 select email into mail from auth.users where id=auth.uid();
 select * into inv from invitations where token_hash=encode(digest(p_token,'sha256'),'hex') and email=lower(mail) and used_at is null and expires_at>now() for update;
 if not found then raise exception '초대 코드 또는 대상 계정을 확인해 주세요'; end if;
 if exists(select 1 from members where user_id=auth.uid()) then raise exception '기존 참여자의 접근·권한은 관리자가 변경해야 합니다'; end if;
 insert into members(user_id,display_name,role) values(auth.uid(),trim(p_name),inv.role);
 update invitations set used_at=now(),used_by=auth.uid() where id=inv.id;
end $$;

-- Reserve byte budget before Storage upload to serialize concurrent quota checks.
create function public.reserve_asset(p_id uuid,p_entry uuid,p_name text,p_mime text,p_size bigint) returns public.assets
language plpgsql security definer set search_path=public as $$
declare e entries; a assets;
begin
 perform pg_advisory_xact_lock(73002);
 select * into e from entries where id=p_entry for update;
 if not found or e.deleted_at is not null or not can_edit(e.author_id) then raise exception '첨부 권한이 없습니다'; end if;
 if p_size<=0 or p_size>10485760 or (p_mime like 'image/%' and p_size>2097152) then raise exception '사진 2MB·문서 10MB 한도를 초과했습니다'; end if;
 if p_name !~* '\.(jpg|jpeg|png|webp|pdf|xlsx?|docx?|hwp|hwpx|txt|csv)$' or length(p_name)>200 then raise exception '지원하지 않는 파일 형식입니다'; end if;
 if p_mime not in ('image/jpeg','image/png','image/webp','application/pdf','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/x-hwp','application/haansofthwp','application/vnd.hancom.hwp','application/vnd.hancom.hwpx','application/octet-stream','text/plain','text/csv') then raise exception '지원하지 않는 파일 형식입니다'; end if;
 if e.kind='log' and p_mime not in ('image/jpeg','image/png','image/webp') then raise exception '일지에는 사진만 첨부할 수 있습니다'; end if;
 if (select count(*) from assets where entry_id=p_entry and deleted_at is null)>=10 then raise exception '한 기록에 첨부는 최대 10개입니다'; end if;
 if (select coalesce(sum(size),0) from assets)+p_size>900000000 then raise exception '농장 저장 한도 900MB에 도달했습니다. 관리자에게 문의해 주세요'; end if;
 insert into assets(id,entry_id,path,name,mime,size,author_id) values(p_id,p_entry,p_entry::text||'/'||p_id::text,p_name,p_mime,p_size,auth.uid()) returning * into a;
 return a;
end $$;
create function public.finish_asset(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare a assets; actual bigint;
begin
 select * into a from assets where id=p_id for update;
 if not found or not exists(select 1 from entries where id=a.entry_id and deleted_at is null and can_edit(author_id)) then raise exception '권한이 없습니다'; end if;
 select (metadata->>'size')::bigint into actual from storage.objects where bucket_id='farm-files' and name=a.path;
 if actual is null or actual<>a.size then raise exception '업로드 파일 크기가 일치하지 않습니다'; end if;
 update assets set ready=true where id=p_id;
end $$;
create function public.cancel_asset(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare a assets;
begin
 select * into a from assets where id=p_id for update;
 if not found or not exists(select 1 from entries where id=a.entry_id and can_edit(author_id)) then raise exception '권한이 없습니다'; end if;
 if exists(select 1 from storage.objects where bucket_id='farm-files' and name=a.path) then raise exception '저장소 파일을 먼저 삭제해야 합니다'; end if;
 delete from assets where id=p_id and not ready;
end $$;
create function public.purge_entry(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if my_role() is distinct from 'admin' then raise exception '관리자 권한이 필요합니다'; end if;
 perform 1 from entries where id=p_id and deleted_at is not null for update;
 if not found then raise exception '휴지통 항목만 영구 삭제할 수 있습니다'; end if;
 if exists(select 1 from entries where plan_id=p_id) then raise exception '연결된 일지가 있어 계획을 영구 삭제할 수 없습니다'; end if;
 if exists(select 1 from assets a join storage.objects o on o.bucket_id='farm-files' and o.name=a.path where a.entry_id=p_id) then raise exception '첨부파일을 먼저 삭제해야 합니다'; end if;
 delete from assets where entry_id=p_id;
 delete from entries where id=p_id;
end $$;
create function public.asset_access(p_path text,p_write boolean default false,p_delete boolean default false) returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce(exists(select 1 from assets a join entries e on e.id=a.entry_id where a.path=p_path and
 case when p_delete then (my_role()='admin' and e.deleted_at is not null) or (not a.ready and can_edit(e.author_id))
 when p_write then not a.ready and e.deleted_at is null and can_edit(e.author_id)
 else my_role() is not null and (e.deleted_at is null or my_role()='admin') and (a.ready or can_edit(e.author_id)) end),false)
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('farm-files','farm-files',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/x-hwp','application/haansofthwp','application/vnd.hancom.hwp','application/vnd.hancom.hwpx','application/octet-stream','text/plain','text/csv']);
create policy file_read on storage.objects for select to authenticated using(bucket_id='farm-files' and asset_access(name));
create policy file_insert on storage.objects for insert to authenticated with check(bucket_id='farm-files' and asset_access(name,true));
create policy file_delete on storage.objects for delete to authenticated using(bucket_id='farm-files' and asset_access(name,false,true));
-- No UPDATE storage policy: existing file contents cannot be silently overwritten.
revoke all on public.entries,public.members,public.farm_settings,public.assets,public.invitations,public.audit_log from anon,authenticated;
grant select on public.entries,public.members,public.farm_settings,public.assets,public.audit_log to authenticated;
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function public.my_role(),public.can_edit(uuid),public.asset_access(text,boolean,boolean),public.save_entry(uuid,integer,jsonb),public.trash_entry(uuid,integer,boolean),public.update_member(uuid,public.farm_role,boolean),public.save_settings(integer,text,text[],text[]),public.create_invitation(text,public.farm_role),public.accept_invitation(text,text),public.reserve_asset(uuid,uuid,text,text,bigint),public.finish_asset(uuid),public.cancel_asset(uuid),public.purge_entry(uuid) to authenticated;

-- Storage API may test INSERT with empty metadata before upload. Validate the actual
-- byte count again when final metadata is persisted; cannot under-reserve quota.
create function public.check_asset_bytes() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if NEW.bucket_id='farm-files' and NEW.metadata->>'size' is not null and not exists(select 1 from assets where path=NEW.name and size=(NEW.metadata->>'size')::bigint) then
  raise exception '첨부 예약 크기와 실제 파일 크기가 일치하지 않습니다';
 end if;
 return NEW;
end $$;
revoke all on function public.check_asset_bytes() from public,anon,authenticated;
create trigger check_farm_asset_bytes before insert or update on storage.objects for each row execute function public.check_asset_bytes();

-- Additive shared accounting. Existing farm records and roles are not modified.
begin;
create table if not exists public.accounting_settings (
 id boolean primary key default true check(id), account_name text not null default '',
 bank_name text not null default '카카오뱅크' check(bank_name='카카오뱅크'),
 account_number text not null default '' check(account_number ~ '^[0-9-]{0,30}$'),
 version integer not null default 1, updated_at timestamptz not null default now(), updated_by uuid references auth.users(id)
);
insert into public.accounting_settings(id) values(true) on conflict do nothing;
create table if not exists public.accounting_roles (
 user_id uuid primary key references public.members(user_id), granted_by uuid not null references auth.users(id), granted_at timestamptz not null default now()
);
create table if not exists public.accounting_categories (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 80),
 direction text not null check(direction in ('income','expense')), active boolean not null default true,
 unique(name,direction)
);
insert into public.accounting_categories(name,direction) values
 ('회원 회비','income'),('농산물 판매','income'),('공동체 행사 및 교육 수입','income'),('지원금 및 후원금','income'),('기타 수입','income'),
 ('종자·모종 구입','expense'),('비료·토양개량제·농약 등 농자재','expense'),('시설·장비 구입 및 유지관리','expense'),('농장 운영비','expense'),('교육·행사비','expense'),('기타 지출','expense') on conflict do nothing;
create table if not exists public.accounting_imports (
 id uuid primary key, file_hash text not null check(file_hash ~ '^[a-f0-9]{64}$'), file_type text not null check(file_type in ('xlsx','xls','csv')),
 file_size integer not null check(file_size between 1 and 10485760), mapping jsonb not null default '{}',
 created_at timestamptz not null default now(), created_by uuid not null references public.members(user_id),
 new_count integer not null default 0, duplicate_count integer not null default 0, error_count integer not null default 0, excluded_count integer not null default 0,
 cancelled_at timestamptz, cancelled_by uuid references public.members(user_id), cancel_reason text
);
create table if not exists public.accounting_transactions (
 id uuid primary key default gen_random_uuid(), import_id uuid not null references public.accounting_imports(id),
 source_key text not null, fingerprint text not null, source_sheet integer not null, source_row integer not null,
 occurred_at timestamp not null, time_precision text not null check(time_precision in ('date','minute','second')),
 direction text not null check(direction in ('income','expense')), amount bigint not null check(amount between 1 and 1000000000000),
 description_original text not null check(length(description_original)<=1000), bank_reference text not null default '',
 balance bigint check(balance between -1000000000000000 and 1000000000000000),
 category_id uuid references public.accounting_categories(id), note text not null default '' check(length(note)<=1000),
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), updated_by uuid references public.members(user_id),
 voided_at timestamptz
);
create unique index if not exists accounting_source_active on public.accounting_transactions(source_key) where voided_at is null;
create unique index if not exists accounting_reference_active on public.accounting_transactions(bank_reference) where voided_at is null and bank_reference<>'';
create index if not exists accounting_fingerprint on public.accounting_transactions(fingerprint) where voided_at is null;
create index if not exists accounting_dates on public.accounting_transactions(occurred_at desc) where voided_at is null;
create table if not exists public.accounting_import_items (
 id uuid primary key default gen_random_uuid(), import_id uuid not null references public.accounting_imports(id),
 source_sheet integer not null, source_row integer not null, status text not null check(status in ('new','duplicate','error','excluded')),
 transaction_id uuid references public.accounting_transactions(id), reason text not null default ''
);
create index if not exists accounting_item_transaction on public.accounting_import_items(transaction_id);
create table if not exists public.accounting_audit (
 id uuid primary key default gen_random_uuid(), entity text not null, entity_id text not null, action text not null,
 actor_id uuid references public.members(user_id), at timestamptz not null default now(), before_value jsonb, after_value jsonb
);
-- No direct authenticated access, including administrators. All access uses checked RPCs.
do $$ declare t text; begin
 foreach t in array array['accounting_settings','accounting_roles','accounting_categories','accounting_imports','accounting_transactions','accounting_import_items','accounting_audit'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 end loop;
end $$;
create or replace function public.accounting_can_manage() returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(my_role()='admin' or (my_role() is not null and exists(select 1 from accounting_roles where user_id=auth.uid())),false)
$$;
create or replace function public.accounting_mask(v text) returns text language sql immutable set search_path=public as $$
 select regexp_replace(regexp_replace(coalesce(v,''),'[0-9][0-9 -]{7,}[0-9]','[번호 마스킹]','g'),'(^|[[:space:]])([가-힣])([가-힣])([가-힣])([[:space:]]|$)','\1\2*\4\5','g')
$$;
create or replace function public.accounting_immutable() returns trigger language plpgsql set search_path=public as $$
begin
 if (to_jsonb(new)-array['category_id','note','version','updated_at','updated_by','voided_at']) is distinct from (to_jsonb(old)-array['category_id','note','version','updated_at','updated_by','voided_at']) then raise exception '은행 원본 거래는 변경할 수 없습니다'; end if;
 return new;
end $$;
drop trigger if exists accounting_immutable on public.accounting_transactions;
create trigger accounting_immutable before update on public.accounting_transactions for each row execute function public.accounting_immutable();
create or replace function public.accounting_row(j jsonb) returns jsonb language plpgsql set search_path=public,extensions as $$
declare stamp timestamp; amount_value bigint; balance_value bigint; description_value text; reference_value text; fp text;
begin
 if jsonb_typeof(j)<>'object' or coalesce(j->>'source_sheet','') !~ '^[0-9]{1,3}$' or coalesce(j->>'source_row','') !~ '^[1-9][0-9]{0,5}$' then raise exception '원본 행 위치를 확인해 주세요'; end if;
 if coalesce(j->>'occurred_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$' then raise exception '거래일시 형식을 확인해 주세요'; end if;
 stamp=(j->>'occurred_at')::timestamp;
 if stamp<'2000-01-01' or stamp>='2201-01-01' or coalesce(j->>'time_precision','') not in ('date','minute','second') then raise exception '거래일시 범위를 확인해 주세요'; end if;
 if coalesce(j->>'direction','') not in ('income','expense') or coalesce(j->>'amount','') !~ '^[0-9]{1,13}$' then raise exception '입출금과 정수 금액을 확인해 주세요'; end if;
 amount_value=(j->>'amount')::bigint;
 if amount_value not between 1 and 1000000000000 then raise exception '금액 범위를 확인해 주세요'; end if;
 if j->>'balance' is not null and j->>'balance'<>'' then
 if j->>'balance' !~ '^-?[0-9]{1,16}$' then raise exception '잔액은 정수 원 단위여야 합니다'; end if;
 balance_value=(j->>'balance')::bigint;
 if balance_value not between -1000000000000000 and 1000000000000000 then raise exception '잔액 범위를 확인해 주세요'; end if;
 end if;
 if jsonb_typeof(j->'description') is distinct from 'string' then raise exception '거래내용을 확인해 주세요'; end if;
 description_value=j->>'description'; reference_value=trim(coalesce(j->>'bank_reference',''));
 if length(description_value)>1000 or length(reference_value)>100 then raise exception '거래내용 또는 고유번호가 너무 깁니다'; end if;
 fp=encode(digest(jsonb_build_array(to_char(stamp,'YYYY-MM-DD"T"HH24:MI:SS'),j->>'time_precision',j->>'direction',amount_value,description_value,balance_value)::text,'sha256'),'hex');
 return jsonb_build_object('valid',true,'occurred_at',to_char(stamp,'YYYY-MM-DD"T"HH24:MI:SS'),'time_precision',j->>'time_precision','direction',j->>'direction','amount',amount_value,'balance',balance_value,'description',description_value,'bank_reference',reference_value,'fingerprint',fp,'source_sheet',(j->>'source_sheet')::integer,'source_row',(j->>'source_row')::integer);
exception when others then
 return jsonb_build_object('valid',false,'reason',case when sqlstate like '22%' then '날짜·금액·행 위치 형식이 올바르지 않습니다' else sqlerrm end);
end $$;
create or replace function public.accounting_preview(p_file_hash text,p_rows jsonb) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare j jsonb; r jsonb; items jsonb='[]'; seen text[]='{}'; references_seen text[]='{}'; sources text[]='{}'; src text; existing accounting_transactions; candidates jsonb; state text;
begin
 if not accounting_can_manage() then raise exception '관리자 또는 총무 권한이 필요합니다'; end if;
 if coalesce(p_file_hash,'') !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_rows)<>'array' then raise exception '업로드 형식을 확인해 주세요'; end if;
 if jsonb_array_length(p_rows) not between 1 and 5000 or octet_length(p_rows::text)>12000000 then raise exception '한 번에 5,000행·10MB 이하 파일을 사용해 주세요'; end if;
 for j in select value from jsonb_array_elements(p_rows) loop
 r=accounting_row(j); state='new'; candidates='[]'; existing=null;
 src=encode(digest(p_file_hash||':'||coalesce(j->>'source_sheet','')||':'||coalesce(j->>'source_row',''),'sha256'),'hex');
 if not (r->>'valid')::boolean then state='error';
 elsif r->>'bank_reference'<>'' and (r->>'bank_reference')=any(references_seen) then state='error';r=r||jsonb_build_object('reason','파일 안의 거래 고유번호가 반복되었습니다. 원본 반복 행을 확인해 주세요');
 elsif src=any(sources) then state='error'; r=r||jsonb_build_object('reason','같은 원본 행이 두 번 전달되었습니다');
 else
 select * into existing from accounting_transactions where source_key=src and voided_at is null;
 if found then
 if existing.fingerprint=r->>'fingerprint' and existing.bank_reference=r->>'bank_reference' then state='duplicate'; else state='error';r=r||jsonb_build_object('reason','이미 올린 원본 행과 매핑 결과가 다릅니다'); end if;
 elsif r->>'bank_reference'<>'' then
 select * into existing from accounting_transactions where bank_reference=r->>'bank_reference' and voided_at is null;
 if found then
 if existing.fingerprint=r->>'fingerprint' then state='duplicate'; else state='error';r=r||jsonb_build_object('reason','같은 거래 고유번호의 금액·내용이 다릅니다'); end if;
 end if;
 end if;
 if state='new' and existing.id is null then
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'source_row',source_row,'import_id',import_id) order by created_at),'[]') into candidates from accounting_transactions where fingerprint=r->>'fingerprint' and voided_at is null;
 if jsonb_array_length(candidates)>0 or (r->>'fingerprint')=any(seen) then state='review'; end if;
 end if;
 end if;
 items=items||jsonb_build_array(jsonb_build_object('row_key',coalesce(j->>'source_sheet','')||':'||coalesce(j->>'source_row',''),'source_sheet',j->'source_sheet','source_row',j->'source_row','status',state,'data',r,'candidates',candidates,'transaction_id',existing.id));
 sources=array_append(sources,src);if (r->>'valid')::boolean then seen=array_append(seen,r->>'fingerprint'); if r->>'bank_reference'<>'' then references_seen=array_append(references_seen,r->>'bank_reference');end if;end if;
 end loop;
 return items;
end $$;
create or replace function public.accounting_configure(p_version integer,p_name text,p_number text) returns void language plpgsql security definer set search_path=public as $$
declare before_row accounting_settings; number_value text=regexp_replace(coalesce(p_number,''),'[ -]','','g');
begin
 if my_role() is distinct from 'admin' then raise exception '관리자만 계좌정보를 설정할 수 있습니다'; end if;
 perform pg_advisory_xact_lock(73020);select * into before_row from accounting_settings where id for update;
 if p_version is distinct from before_row.version then raise exception '설정이 변경되었습니다. 새로고침해 주세요' using errcode='PT409';end if;
 if length(trim(p_name)) not between 1 and 100 or number_value !~ '^[0-9]{8,20}$' then raise exception '계좌 명칭과 숫자 계좌번호를 확인해 주세요'; end if;
 if before_row.account_number<>number_value and exists(select 1 from accounting_transactions where voided_at is null) then raise exception '거래가 있는 계좌번호는 변경할 수 없습니다. 기존 업로드와 계좌를 먼저 확인해 주세요';end if;
 update accounting_settings set account_name=trim(p_name),account_number=number_value,version=version+1,updated_at=now(),updated_by=auth.uid() where id;
 insert into accounting_audit(entity,entity_id,action,actor_id,before_value,after_value) values('settings','true','update',auth.uid(),jsonb_build_object('name',before_row.account_name,'account','[비공개]'),jsonb_build_object('name',trim(p_name),'account','[비공개]'));
end $$;
create or replace function public.accounting_set_treasurer(p_user uuid,p_enabled boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 if my_role() is distinct from 'admin' then raise exception '관리자만 총무를 지정할 수 있습니다'; end if;
 if not exists(select 1 from members where user_id=p_user and active) then raise exception '현재 참여자만 지정할 수 있습니다'; end if;
 if p_enabled then insert into accounting_roles(user_id,granted_by) values(p_user,auth.uid()) on conflict(user_id) do nothing;
 else delete from accounting_roles where user_id=p_user; end if;
 insert into accounting_audit(entity,entity_id,action,actor_id,after_value) values('treasurer',p_user::text,'role',auth.uid(),jsonb_build_object('enabled',p_enabled));
end $$;
create or replace function public.accounting_save_category(p_name text,p_direction text) returns void language plpgsql security definer set search_path=public as $$
begin
 if my_role() is distinct from 'admin' then raise exception '관리자만 분류를 추가할 수 있습니다';end if;
 if length(trim(p_name)) not between 1 and 80 or p_direction not in ('income','expense') then raise exception '분류를 확인해 주세요';end if;
 insert into accounting_categories(name,direction) values(trim(p_name),p_direction) on conflict(name,direction) do update set active=true;
 insert into accounting_audit(entity,entity_id,action,actor_id,after_value) values('category','new','add',auth.uid(),jsonb_build_object('name',trim(p_name),'direction',p_direction));
end $$;
create or replace function public.accounting_import(p_id uuid,p_file_hash text,p_rows jsonb,p_decisions jsonb,p_meta jsonb) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare batch accounting_imports; previews jsonb; item jsonb; r jsonb; choice text; txid uuid; src text; state text; cat uuid; n integer=0; d integer=0; e integer=0; x integer=0; clean_mapping jsonb='{}'; key_value text; map_value jsonb;
begin
 if not accounting_can_manage() then raise exception '관리자 또는 총무 권한이 필요합니다';end if;
 perform pg_advisory_xact_lock(73020);
 select * into batch from accounting_imports where id=p_id;
 if found then
 if batch.cancelled_at is not null then raise exception '취소한 업로드는 새 업로드로 다시 확인해 주세요';end if;
 if batch.file_hash<>p_file_hash then raise exception '업로드 식별자가 다른 파일에 사용되었습니다'; end if;
 return to_jsonb(batch);
 end if;
 if (select account_number='' from accounting_settings where id) then raise exception '관리자가 계좌정보를 먼저 등록해 주세요';end if;
 if p_id is null or coalesce(p_meta->>'file_type','') not in ('xlsx','xls','csv') or coalesce(p_meta->>'file_size','') !~ '^[0-9]{1,8}$' or (p_meta->>'file_size')::integer not between 1 and 10485760 or octet_length(coalesce(p_meta->'mapping','{}')::text)>3000 then raise exception '파일 정보와 크기를 확인해 주세요';end if;
 if p_meta ? 'mapping' then
 if jsonb_typeof(p_meta->'mapping') is distinct from 'object' then raise exception '열 연결 설정을 확인해 주세요';end if;
 for key_value,map_value in select * from jsonb_each(p_meta->'mapping') loop
 if key_value not in ('date','time','direction','amount','income','expense','description','balance','reference') or map_value::text !~ '^(-1|[0-9]{1,2})$' then raise exception '열 연결 설정은 열 번호만 저장합니다';end if;
 clean_mapping=clean_mapping||jsonb_build_object(key_value,map_value);
 end loop;
 end if;
 previews=accounting_preview(p_file_hash,p_rows);
 insert into accounting_imports(id,file_hash,file_type,file_size,mapping,created_by) values(p_id,p_file_hash,p_meta->>'file_type',(p_meta->>'file_size')::integer,clean_mapping,auth.uid());
 for item in select value from jsonb_array_elements(previews) loop
 r=item->'data';state=item->>'status';choice=p_decisions->>(item->>'row_key');txid=null;
 if state='error' then e=e+1;
 elsif state='duplicate' then d=d+1;txid=(item->>'transaction_id')::uuid;
 elsif state='review' and choice is null then raise exception '중복 의심 행을 확인해 신규 또는 제외를 선택해 주세요';
 elsif state='review' and choice='exclude' then state='excluded';x=x+1;
 elsif state='review' and choice<>'new' then
 select id into txid from accounting_transactions where id=choice::uuid and fingerprint=r->>'fingerprint' and voided_at is null;
 if not found then raise exception '중복 판단 대상이 변경되었습니다. 미리보기를 새로 실행해 주세요';end if;
 state='duplicate';d=d+1;
 else
 src=encode(digest(p_file_hash||':'||(r->>'source_sheet')||':'||(r->>'source_row'),'sha256'),'hex');
 -- A bank reference is unique even if it occurs twice inside this upload.
 if r->>'bank_reference'<>'' then
 select id into txid from accounting_transactions where bank_reference=r->>'bank_reference' and voided_at is null;
 if found then raise exception '파일 안의 거래 고유번호가 중복됩니다. 반복 행을 제외해 주세요';end if;
 end if;
 select id into cat from accounting_categories where active and direction=r->>'direction' and name=case when r->>'direction'='income' then case when r->>'description' ~ '회비' then '회원 회비' when r->>'description' ~ '판매|수확물' then '농산물 판매' when r->>'description' ~ '후원|지원금|보조금' then '지원금 및 후원금' when r->>'description' ~ '교육|행사' then '공동체 행사 및 교육 수입' else '기타 수입' end else case when r->>'description' ~ '종자|모종|씨앗' then '종자·모종 구입' when r->>'description' ~ '비료|퇴비|농약|토양' then '비료·토양개량제·농약 등 농자재' when r->>'description' ~ '시설|장비|수리' then '시설·장비 구입 및 유지관리' when r->>'description' ~ '교육|행사' then '교육·행사비' when r->>'description' ~ '임차|전기|수도|운영' then '농장 운영비' else '기타 지출' end end;
 insert into accounting_transactions(import_id,source_key,fingerprint,source_sheet,source_row,occurred_at,time_precision,direction,amount,description_original,bank_reference,balance,category_id,updated_by)
 values(p_id,src,r->>'fingerprint',(r->>'source_sheet')::integer,(r->>'source_row')::integer,(r->>'occurred_at')::timestamp,r->>'time_precision',r->>'direction',(r->>'amount')::bigint,r->>'description',r->>'bank_reference',(r->>'balance')::bigint,cat,auth.uid()) returning id into txid;
 state='new';n=n+1;
 end if;
 insert into accounting_import_items(import_id,source_sheet,source_row,status,transaction_id,reason) values(p_id,case when item->>'source_sheet' ~ '^[0-9]{1,3}$' then (item->>'source_sheet')::integer else 0 end,case when item->>'source_row' ~ '^[1-9][0-9]{0,5}$' then (item->>'source_row')::integer else 0 end,state,txid,coalesce(r->>'reason',''));
 end loop;
 update accounting_imports set new_count=n,duplicate_count=d,error_count=e,excluded_count=x where id=p_id returning * into batch;
 insert into accounting_audit(entity,entity_id,action,actor_id,after_value) values('import',p_id::text,'import',auth.uid(),jsonb_build_object('new',n,'duplicate',d,'error',e,'excluded',x));
 return to_jsonb(batch);
end $$;
create or replace function public.accounting_edit(p_id uuid,p_version integer,p_category uuid,p_note text) returns void language plpgsql security definer set search_path=public as $$
declare old_row accounting_transactions;
begin
 if not accounting_can_manage() then raise exception '관리자 또는 총무 권한이 필요합니다'; end if;
 perform pg_advisory_xact_lock(73020);select * into old_row from accounting_transactions where id=p_id and voided_at is null for update;
 if not found then raise exception '현재 거래를 찾을 수 없습니다';end if;
 if old_row.version is distinct from p_version then raise exception '거래가 변경되었습니다. 다시 열어 주세요' using errcode='PT409';end if;
 if length(coalesce(p_note,''))>1000 or not exists(select 1 from accounting_categories where id=p_category and direction=old_row.direction and (active or id=old_row.category_id)) then raise exception '분류와 비고를 확인해 주세요';end if;
 update accounting_transactions set category_id=p_category,note=coalesce(p_note,''),version=version+1,updated_at=now(),updated_by=auth.uid() where id=p_id;
 insert into accounting_audit(entity,entity_id,action,actor_id,before_value,after_value) values('transaction',p_id::text,'annotation',auth.uid(),jsonb_build_object('category',old_row.category_id,'note',old_row.note),jsonb_build_object('category',p_category,'note',p_note));
end $$;
create or replace function public.accounting_cancel(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path=public as $$
begin
 if my_role() is distinct from 'admin' then raise exception '관리자만 업로드를 취소할 수 있습니다';end if;
 if length(trim(coalesce(p_reason,''))) not between 4 and 300 then raise exception '취소 사유를 4~300자로 입력해 주세요';end if;
 perform pg_advisory_xact_lock(73020);
 if not exists(select 1 from accounting_imports where id=p_id and cancelled_at is null) then raise exception '유효한 업로드를 찾을 수 없습니다';end if;
 if exists(select 1 from accounting_import_items item join accounting_transactions tx on tx.id=item.transaction_id join accounting_imports other_batch on other_batch.id=item.import_id where tx.import_id=p_id and item.import_id<>p_id and other_batch.cancelled_at is null) then raise exception '이 거래를 참조하는 다른 업로드를 먼저 취소해야 합니다';end if;
 update accounting_imports set cancelled_at=now(),cancelled_by=auth.uid(),cancel_reason=trim(p_reason) where id=p_id;
 update accounting_transactions set voided_at=now(),version=version+1,updated_at=now(),updated_by=auth.uid() where import_id=p_id and voided_at is null;
 insert into accounting_audit(entity,entity_id,action,actor_id,after_value) values('import',p_id::text,'cancel',auth.uid(),jsonb_build_object('reason',trim(p_reason)));
end $$;

create or replace function public.accounting_overview(p_from date default null,p_to date default null,p_direction text default '',p_query text default '',p_offset integer default 0,p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare items jsonb; total integer; income_value text; expense_value text; monthly jsonb; grouped jsonb; latest_date timestamp; balance_date timestamp; balance_value text; ambiguous boolean=false; gap_count integer; manager boolean;
begin
 if my_role() is null then raise exception '농장 참여자만 회계를 열람할 수 있습니다';end if;
 if p_direction not in ('','income','expense') or p_offset<0 or p_limit not between 1 and 500 or length(p_query)>200 or (p_from is not null and p_to is not null and p_from>p_to) then raise exception '조회 조건을 확인해 주세요';end if;
 manager=accounting_can_manage();
 with visible as (
 select t.*,case when manager then t.description_original else accounting_mask(t.description_original) end as description,
 case when manager then t.note else accounting_mask(t.note) end as visible_note,c.name as category
 from accounting_transactions t left join accounting_categories c on c.id=t.category_id where t.voided_at is null
 ), filtered as (
 select * from visible v where (p_from is null or occurred_at::date>=p_from) and (p_to is null or occurred_at::date<=p_to)
 and (p_direction='' or direction=p_direction)
 and not exists(select 1 from unnest(regexp_split_to_array(lower(normalize(trim(p_query),NFKC)),'\s+')) term where term<>'' and position(term in lower(normalize(concat_ws(' ',description,visible_note,category,to_char(occurred_at,'YYYY-MM-DD HH24:MI:SS'),to_char(occurred_at,'YYYY"년"MM"월"DD"일"'),amount::text,case when direction='income' then '입금 수입' else '출금 지출' end),NFKC)))=0)
 ), paged as (select * from filtered order by occurred_at desc,created_at desc,id limit p_limit offset p_offset)
 select (select count(*) from filtered),coalesce((select jsonb_agg(jsonb_build_object('id',id,'import_id',import_id,'occurred_at',occurred_at,'time_precision',time_precision,'direction',direction,'amount',amount,'description',description,'balance',balance,'category_id',category_id,'category',category,'note',visible_note,'version',version) order by occurred_at desc,created_at desc,id) from paged),'[]') into total,items;
 select coalesce(sum(amount) filter(where direction='income'),0)::text,coalesce(sum(amount) filter(where direction='expense'),0)::text into income_value,expense_value from accounting_transactions where voided_at is null and (p_from is null or occurred_at::date>=p_from) and (p_to is null or occurred_at::date<=p_to);
 select coalesce(jsonb_agg(to_jsonb(m) order by "month"),'[]') into monthly from (select to_char(occurred_at,'YYYY-MM') as "month",coalesce(sum(amount) filter(where direction='income'),0)::text income,coalesce(sum(amount) filter(where direction='expense'),0)::text expense from accounting_transactions where voided_at is null and (p_from is null or occurred_at::date>=p_from) and (p_to is null or occurred_at::date<=p_to) group by 1) m;
 select coalesce(jsonb_agg(to_jsonb(g) order by (g.total)::numeric desc),'[]') into grouped from (select coalesce(c.name,'미분류') category,sum(t.amount)::text total from accounting_transactions t left join accounting_categories c on c.id=t.category_id where t.voided_at is null and t.direction='expense' and (p_from is null or occurred_at::date>=p_from) and (p_to is null or occurred_at::date<=p_to) group by c.name) g;
 select max(occurred_at) into latest_date from accounting_transactions where voided_at is null;
 select max(occurred_at) into balance_date from accounting_transactions where voided_at is null and balance is not null;
 select count(distinct balance)>1,max(balance)::text into ambiguous,balance_value from accounting_transactions where voided_at is null and occurred_at=balance_date;
 if exists(select 1 from accounting_transactions where voided_at is null and time_precision='date' and occurred_at::date=balance_date::date) and (select count(*) from accounting_transactions where voided_at is null and occurred_at::date=balance_date::date)>1 then ambiguous=true;end if;
 if ambiguous then balance_value=null;end if;
 with running as (select occurred_at,created_at,id,balance,sum(case when direction='income' then amount else -amount end) over(order by occurred_at,created_at,id) movement from accounting_transactions where voided_at is null), known as (select occurred_at,balance,movement,lag(balance) over(order by occurred_at,created_at,id) previous_balance,lag(movement) over(order by occurred_at,created_at,id) previous_movement,lag(occurred_at) over(order by occurred_at,created_at,id) previous_time from running where balance is not null) select count(*) into gap_count from known where previous_time<occurred_at and balance-previous_balance<>movement-previous_movement;
 return jsonb_build_object('items',items,'total',total,'income',income_value,'expense',expense_value,'monthly',monthly,'categories',grouped,'last_transaction_at',latest_date,'bank_balance',balance_value,'bank_balance_at',balance_date,'balance_ambiguous',ambiguous,'gap_count',gap_count,'last_upload_at',(select max(created_at) from accounting_imports),'last_changed_at',(select max(changed) from (select updated_at changed from accounting_transactions union all select created_at from accounting_imports union all select cancelled_at from accounting_imports) changes),'can_manage',manager,'settings',(select to_jsonb(s) from accounting_settings s where id),'category_options',(select coalesce(jsonb_agg(to_jsonb(c) order by direction,name),'[]') from accounting_categories c),'treasurers',case when my_role()='admin' then (select coalesce(jsonb_agg(user_id),'[]') from accounting_roles) else '[]'::jsonb end);
end $$;
create or replace function public.accounting_history() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not accounting_can_manage() then raise exception '관리자 또는 총무 권한이 필요합니다';end if;
 return jsonb_build_object('imports',(select coalesce(jsonb_agg(to_jsonb(b) order by created_at desc),'[]') from (select * from accounting_imports order by created_at desc limit 100) b),'errors',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from (select item.* from accounting_import_items item join accounting_imports b on b.id=item.import_id where item.status='error' order by b.created_at desc limit 200) e),'audit',case when my_role()='admin' then (select coalesce(jsonb_agg(to_jsonb(a) order by at desc),'[]') from (select * from accounting_audit order by at desc limit 200) a) else '[]'::jsonb end);
end $$;
create or replace function public.accounting_backup() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if my_role() is distinct from 'admin' then raise exception '관리자만 회계를 백업할 수 있습니다';end if;
 return jsonb_build_object('format',1,'settings',(select to_jsonb(s) from accounting_settings s where id),'roles',(select coalesce(jsonb_agg(to_jsonb(r) order by user_id),'[]') from accounting_roles r),'categories',(select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') from accounting_categories c),'imports',(select coalesce(jsonb_agg(to_jsonb(b) order by id),'[]') from accounting_imports b),'transactions',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from accounting_transactions t),'items',(select coalesce(jsonb_agg(to_jsonb(i) order by id),'[]') from accounting_import_items i),'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from accounting_audit a));
end $$;
create or replace function public.accounting_report(p_from date default null,p_to date default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare base jsonb; rows jsonb;
begin
 base=accounting_overview(p_from,p_to,'','',0,1);
 if (base->>'total')::integer>10000 then raise exception '보고서는 10,000건 이하 기간으로 나눠 내려받아 주세요';end if;
 select coalesce(jsonb_agg(jsonb_build_object('occurred_at',t.occurred_at,'time_precision',t.time_precision,'direction',t.direction,'amount',t.amount,'description',case when accounting_can_manage() then t.description_original else accounting_mask(t.description_original) end,'balance',t.balance,'category',c.name,'note',case when accounting_can_manage() then t.note else accounting_mask(t.note) end) order by occurred_at desc,created_at desc,t.id),'[]') into rows from accounting_transactions t left join accounting_categories c on c.id=t.category_id where t.voided_at is null and (p_from is null or t.occurred_at::date>=p_from) and (p_to is null or t.occurred_at::date<=p_to);
 return (base-'items')||jsonb_build_object('items',rows,'from',p_from,'to',p_to);
end $$;
-- Private helpers cannot be called through the public API.
revoke all on function public.accounting_can_manage(),public.accounting_mask(text),public.accounting_immutable(),public.accounting_row(jsonb) from public,anon,authenticated;
revoke all on function public.accounting_preview(text,jsonb),public.accounting_configure(integer,text,text),public.accounting_set_treasurer(uuid,boolean),public.accounting_save_category(text,text),public.accounting_import(uuid,text,jsonb,jsonb,jsonb),public.accounting_edit(uuid,integer,uuid,text),public.accounting_cancel(uuid,text),public.accounting_overview(date,date,text,text,integer,integer),public.accounting_history(),public.accounting_backup(),public.accounting_report(date,date) from public,anon;
grant execute on function public.accounting_preview(text,jsonb),public.accounting_configure(integer,text,text),public.accounting_set_treasurer(uuid,boolean),public.accounting_save_category(text,text),public.accounting_import(uuid,text,jsonb,jsonb,jsonb),public.accounting_edit(uuid,integer,uuid,text),public.accounting_cancel(uuid,text),public.accounting_overview(date,date,text,text,integer,integer),public.accounting_history(),public.accounting_backup(),public.accounting_report(date,date) to authenticated;
grant all on public.accounting_settings,public.accounting_roles,public.accounting_categories,public.accounting_imports,public.accounting_transactions,public.accounting_import_items,public.accounting_audit to service_role;
notify pgrst,'reload schema';
commit;

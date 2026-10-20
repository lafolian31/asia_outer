-- Allow the same photo and document attachments on farm logs, activities and resources.
begin;
create or replace function public.reserve_asset(p_id uuid,p_entry uuid,p_name text,p_mime text,p_size bigint) returns public.assets
language plpgsql security definer set search_path=public as $$
declare e entries; a assets;
begin
 perform pg_advisory_xact_lock(73002);
 select * into e from entries where id=p_entry for update;
 if not found or e.deleted_at is not null or not can_edit(e.author_id) then raise exception '첨부 권한이 없습니다'; end if;
 if p_size<=0 or p_size>10485760 or (p_mime like 'image/%' and p_size>2097152) then raise exception '사진 2MB·문서 10MB 한도를 초과했습니다'; end if;
 if p_name !~* '\.(jpg|jpeg|png|webp|pdf|pptx?|xlsx?|docx?|hwp|hwpx|txt|csv)$' or length(p_name)>200 then raise exception '지원하지 않는 파일 형식입니다'; end if;
 if p_mime not in ('image/jpeg','image/png','image/webp','application/pdf','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/x-hwp','application/haansofthwp','application/vnd.hancom.hwp','application/vnd.hancom.hwpx','application/octet-stream','text/plain','text/csv') then raise exception '지원하지 않는 파일 형식입니다'; end if;
 if (select count(*) from assets where entry_id=p_entry and deleted_at is null)>=10 then raise exception '한 기록에 첨부는 최대 10개입니다'; end if;
 if (select coalesce(sum(size),0) from assets)+p_size>900000000 then raise exception '농장 저장 한도 900MB에 도달했습니다. 관리자에게 문의해 주세요'; end if;
 insert into assets(id,entry_id,path,name,mime,size,author_id) values(p_id,p_entry,p_entry::text||'/'||p_id::text,p_name,p_mime,p_size,auth.uid()) returning * into a;
 return a;
end $$;
revoke all on function public.reserve_asset(uuid,uuid,text,text,bigint) from public,anon;
grant execute on function public.reserve_asset(uuid,uuid,text,text,bigint) to authenticated;
-- Keep existing bucket MIME types while allowing PowerPoint documents.
update storage.buckets
set allowed_mime_types = case when allowed_mime_types is null then null else
 array(select distinct unnest(allowed_mime_types || array['application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation'])) end
where id='farm-files';
notify pgrst,'reload schema';
commit;

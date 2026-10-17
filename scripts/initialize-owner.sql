-- Run in the NEW hosted project's SQL editor after the main migration.
-- Create this owner's Auth account first. Replace the two display values below.
do $$
declare
 owner_email text := 'CHANGE_ME';
 owner_name text := '농장 관리자';
 owner_id uuid;
begin
 if owner_email='CHANGE_ME' then raise exception '소유자 이메일을 먼저 지정해 주세요'; end if;
 if exists(select 1 from public.members where role='admin' and active) then raise exception '이미 관리자가 있습니다. 앱의 참여자 관리에서 변경하세요'; end if;
 select id into owner_id from auth.users where lower(email)=lower(owner_email) and email_confirmed_at is not null;
 if owner_id is null then raise exception '확인 완료된 소유자 Auth 계정을 먼저 생성해 주세요'; end if;
 insert into public.members(user_id,display_name,role) values(owner_id,owner_name,'admin');
end $$;

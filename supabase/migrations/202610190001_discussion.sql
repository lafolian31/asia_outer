-- Add comments and one changeable reaction per member to logs and resources.
begin;
create table if not exists public.entry_comments (
  id uuid primary key,
  entry_id uuid not null references public.entries(id) on delete cascade,
  author_id uuid not null references public.members(user_id),
  body text not null check (length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.members(user_id),
  deleted_at timestamptz,
  version integer not null default 1
);
create index if not exists entry_comments_parent on public.entry_comments(entry_id);
create table if not exists public.entry_reactions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries(id) on delete cascade,
  user_id uuid not null references public.members(user_id),
  kind text not null check (kind in ('like','love','laugh','wow')),
  updated_at timestamptz not null default now(),
  unique(entry_id,user_id)
);
alter table public.entry_comments enable row level security;
alter table public.entry_reactions enable row level security;
drop policy if exists comments_read on public.entry_comments;
create policy comments_read on public.entry_comments for select to authenticated using (
  my_role() is not null and (deleted_at is null or my_role()='admin')
  and exists(select 1 from public.entries e where e.id=entry_id and e.kind in ('log','resource')
    and (e.deleted_at is null or my_role()='admin'))
);
drop policy if exists reactions_read on public.entry_reactions;
create policy reactions_read on public.entry_reactions for select to authenticated using (
  my_role() is not null and exists(select 1 from public.entries e where e.id=entry_id
    and e.kind in ('log','resource') and (e.deleted_at is null or my_role()='admin'))
);
drop trigger if exists comment_audit on public.entry_comments;
create trigger comment_audit after insert or update or delete on public.entry_comments
  for each row execute function public.record_audit();
drop trigger if exists reaction_audit on public.entry_reactions;
create trigger reaction_audit after insert or update or delete on public.entry_reactions
  for each row execute function public.record_audit();

create or replace function public.save_comment(p_id uuid,p_entry uuid,p_version integer,p_body text)
returns public.entry_comments language plpgsql security definer set search_path=public as $$
declare item entry_comments;
begin
  if coalesce(my_role() in ('admin','editor'),false)=false then raise exception '댓글 작성 권한이 없습니다'; end if;
  perform 1 from entries where id=p_entry and kind in ('log','resource') and deleted_at is null for update;
  if not found then raise exception '댓글을 달 수 없는 기록입니다'; end if;
  if p_version is null then raise exception '댓글 버전이 필요합니다'; end if;
  if p_body is null or length(trim(p_body)) not between 1 and 5000 then raise exception '댓글은 1~5000자로 입력해 주세요'; end if;
  select * into item from entry_comments where id=p_id for update;
  if found then
    if item.entry_id<>p_entry or item.deleted_at is not null or not can_edit(item.author_id) then raise exception '댓글 수정 권한이 없습니다'; end if;
    -- A retry of a new comment with the same ID and body cannot duplicate it.
    if p_version=0 and item.author_id=auth.uid() and item.body=trim(p_body) then return item; end if;
    if item.version<>p_version then raise exception '댓글이 변경되었습니다. 새로고침 후 다시 수정해 주세요' using errcode='PT409'; end if;
    update entry_comments set body=trim(p_body),updated_at=now(),updated_by=auth.uid(),version=version+1
      where id=p_id returning * into item;
  else
    if p_version<>0 then raise exception '댓글이 존재하지 않습니다'; end if;
    insert into entry_comments(id,entry_id,author_id,body,updated_by)
      values(p_id,p_entry,auth.uid(),trim(p_body),auth.uid()) returning * into item;
  end if;
  return item;
end $$;

create or replace function public.delete_comment(p_id uuid,p_version integer)
returns void language plpgsql security definer set search_path=public as $$
declare item entry_comments; parent uuid;
begin
  if p_version is null then raise exception '댓글 버전이 필요합니다'; end if;
  select entry_id into parent from entry_comments where id=p_id;
  perform 1 from entries where id=parent and kind in ('log','resource') and deleted_at is null for update;
  if not found then raise exception '댓글을 삭제할 수 없는 기록입니다'; end if;
  select * into item from entry_comments where id=p_id for update;
  if not found or not can_edit(item.author_id) or item.deleted_at is not null then raise exception '댓글 삭제 권한이 없습니다'; end if;
  if item.version<>p_version then raise exception '댓글이 변경되었습니다. 새로고침해 주세요' using errcode='PT409'; end if;
  update entry_comments set deleted_at=now(),updated_at=now(),updated_by=auth.uid(),version=version+1 where id=p_id;
end $$;

create or replace function public.set_reaction(p_entry uuid,p_kind text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if coalesce(my_role() in ('admin','editor'),false)=false then raise exception '감정표현 권한이 없습니다'; end if;
  perform 1 from entries where id=p_entry and kind in ('log','resource') and deleted_at is null for update;
  if not found then raise exception '감정표현을 할 수 없는 기록입니다'; end if;
  if p_kind is null then
    delete from entry_reactions where entry_id=p_entry and user_id=auth.uid();
  else
    if p_kind not in ('like','love','laugh','wow') then raise exception '지원하지 않는 감정표현입니다'; end if;
    insert into entry_reactions(entry_id,user_id,kind) values(p_entry,auth.uid(),p_kind)
      on conflict(entry_id,user_id) do update set kind=excluded.kind,updated_at=now();
  end if;
end $$;

revoke all on public.entry_comments,public.entry_reactions from anon,authenticated;
grant select on public.entry_comments,public.entry_reactions to authenticated;
revoke all on function public.save_comment(uuid,uuid,integer,text),public.delete_comment(uuid,integer),public.set_reaction(uuid,text) from public,anon;
grant execute on function public.save_comment(uuid,uuid,integer,text),public.delete_comment(uuid,integer),public.set_reaction(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;

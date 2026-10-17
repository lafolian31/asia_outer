-- Mirrors hosted Supabase's privileges; table RLS still controls each API user.
grant usage on schema storage to anon,authenticated,service_role;
grant all on all tables in schema storage to anon,authenticated,service_role;
grant all on all sequences in schema storage to anon,authenticated,service_role;

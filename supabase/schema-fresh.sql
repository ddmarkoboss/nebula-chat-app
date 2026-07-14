-- ============================================================
-- Nebula Chat — Fresh Supabase Schema (Idempotent)
-- Run this whole file in: Supabase Dashboard → SQL Editor
-- Safe to run multiple times—won't error or destroy data
-- ============================================================

-- ---------- PROFILES TABLE ----------
do $$
begin
  if not exists (select 1 from information_schema.tables where table_name = 'profiles' and table_schema = 'public') then
    create table public.profiles (
      id uuid primary key references auth.users(id) on delete cascade,
      username text unique not null,
      email text,
      avatar_url text,
      pronouns text,
      bio text,
      status text not null default 'online' check (status in ('online', 'idle', 'dnd', 'offline')),
      status_message text,
      last_seen timestamptz not null default now(),
      created_at timestamptz not null default now()
    );
  end if;
end $$;

-- Add any missing columns to existing profiles table
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists pronouns text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists status text default 'online';
alter table public.profiles add column if not exists status_message text;
alter table public.profiles add column if not exists last_seen timestamptz default now();

alter table public.profiles enable row level security;

-- Profiles RLS Policies
do $$
begin
  create policy "Profiles are viewable by any authenticated user"
    on public.profiles for select
    to authenticated
    using (true);
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "Users can insert their own profile"
    on public.profiles for insert
    to authenticated
    with check (auth.uid() = id);
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "Users can update their own profile"
    on public.profiles for update
    to authenticated
    using (auth.uid() = id);
exception when duplicate_object then null;
end $$;

-- Auto-create profile trigger
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, email)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'username',
      split_part(new.email, '@', 1)
    ),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for existing auth users
insert into public.profiles (id, username, email, status, last_seen, created_at)
select
  u.id,
  coalesce(
    u.raw_user_meta_data->>'username',
    split_part(u.email, '@', 1)
  ) as username,
  u.email,
  'online' as status,
  now() as last_seen,
  now() as created_at
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- Backfill missing emails
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

-- ---------- FRIENDS TABLE ----------
do $$
begin
  if not exists (select 1 from information_schema.tables where table_name = 'friends' and table_schema = 'public') then
    create table public.friends (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users(id) on delete cascade,
      friend_id uuid not null references auth.users(id) on delete cascade,
      status text not null default 'pending' check (status in ('pending', 'accepted', 'blocked')),
      created_at timestamptz not null default now(),
      constraint no_self_friend check (user_id <> friend_id),
      constraint unique_pair unique (user_id, friend_id)
    );
  end if;
end $$;

alter table public.friends enable row level security;

-- Friends RLS Policies
do $$
begin
  create policy "Users can view relationships involving them"
    on public.friends for select
    to authenticated
    using (auth.uid() = user_id or auth.uid() = friend_id);
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "Users can send friend requests"
    on public.friends for insert
    to authenticated
    with check (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "Either party can update a relationship"
    on public.friends for update
    to authenticated
    using (auth.uid() = user_id or auth.uid() = friend_id);
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "Either party can delete a relationship"
    on public.friends for delete
    to authenticated
    using (auth.uid() = user_id or auth.uid() = friend_id);
exception when duplicate_object then null;
end $$;

-- Friend request creation function (secure)
create or replace function public.create_friend_request(requester_id uuid, recipient_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_id uuid;
  inserted_id uuid;
begin
  if requester_id = recipient_id then
    raise exception 'You cannot add yourself as a friend';
  end if;

  select id into existing_id
  from public.friends
  where (user_id = requester_id and friend_id = recipient_id)
     or (user_id = recipient_id and friend_id = requester_id)
  limit 1;

  if existing_id is not null then
    return existing_id;
  end if;

  insert into public.friends (user_id, friend_id, status)
  values (requester_id, recipient_id, 'pending')
  returning id into inserted_id;

  return inserted_id;
end;
$$;

grant execute on function public.create_friend_request(uuid, uuid) to authenticated;

-- ---------- MESSAGES TABLE ----------
do $$
begin
  if not exists (select 1 from information_schema.tables where table_name = 'messages' and table_schema = 'public') then
    create table public.messages (
      id uuid primary key default gen_random_uuid(),
      sender_id uuid not null references auth.users(id) on delete cascade,
      receiver_id uuid not null references auth.users(id) on delete cascade,
      content text,
      file_url text,
      file_name text,
      file_type text,
      created_at timestamptz not null default now(),
      constraint message_has_content check (content is not null or file_url is not null)
    );
  end if;
end $$;

create index if not exists messages_conversation_idx
  on public.messages (least(sender_id, receiver_id), greatest(sender_id, receiver_id), created_at);

alter table public.messages enable row level security;

-- Messages RLS Policies
do $$
begin
  create policy "Users can view their messages"
    on public.messages for select
    to authenticated
    using (auth.uid() = sender_id or auth.uid() = receiver_id);
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "Users can send messages"
    on public.messages for insert
    to authenticated
    with check (auth.uid() = sender_id);
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "Users can update their own messages"
    on public.messages for update
    to authenticated
    using (auth.uid() = sender_id);
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "Users can delete their own messages"
    on public.messages for delete
    to authenticated
    using (auth.uid() = sender_id);
exception when duplicate_object then null;
end $$;

-- ---------- GROUP CHATS TABLE ----------
do $$
begin
  if not exists (select 1 from information_schema.tables where table_name = 'group_chats' and table_schema = 'public') then
    create table public.group_chats (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      created_by uuid not null references auth.users(id) on delete cascade,
      created_at timestamptz not null default now()
    );
  end if;
end $$;

alter table public.group_chats enable row level security;

do $$
begin
  create policy "Members can view their group chats"
    on public.group_chats for select
    to authenticated
    using (exists (select 1 from public.group_chat_members where group_id = group_chats.id and member_id = auth.uid()));
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "Users can create group chats"
    on public.group_chats for insert
    to authenticated
    with check (auth.uid() = created_by);
exception when duplicate_object then null;
end $$;

-- ---------- GROUP CHAT MEMBERS TABLE ----------
do $$
begin
  if not exists (select 1 from information_schema.tables where table_name = 'group_chat_members' and table_schema = 'public') then
    create table public.group_chat_members (
      id uuid primary key default gen_random_uuid(),
      group_id uuid not null references public.group_chats(id) on delete cascade,
      member_id uuid not null references auth.users(id) on delete cascade,
      joined_at timestamptz not null default now(),
      constraint unique_member_per_group unique (group_id, member_id)
    );
  end if;
end $$;

alter table public.group_chat_members enable row level security;

do $$
begin
  create policy "Members can view members"
    on public.group_chat_members for select
    to authenticated
    using (exists (select 1 from public.group_chat_members where group_id = group_chat_members.group_id and member_id = auth.uid()));
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "Group creator can add members"
    on public.group_chat_members for insert
    to authenticated
    with check (exists (select 1 from public.group_chats where id = group_id and created_by = auth.uid()));
exception when duplicate_object then null;
end $$;

-- Update messages table to support group chats
alter table public.messages add column if not exists group_id uuid references public.group_chats(id) on delete cascade;
alter table public.messages add column if not exists sender_name text;

-- Update message policy to include group chats
do $$
begin
  drop policy if exists "Users can view their messages" on public.messages;
exception when undefined_object then null;
when others then null;
end $$;

do $$
begin
  create policy "Users can view their messages"
    on public.messages for select
    to authenticated
    using (
      auth.uid() = sender_id 
      or auth.uid() = receiver_id
      or (group_id is not null and exists (
        select 1 from public.group_chat_members where group_id = messages.group_id and member_id = auth.uid()
      ))
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  drop policy if exists "Users can send messages" on public.messages;
exception when undefined_object then null;
when others then null;
end $$;

do $$
begin
  create policy "Users can send messages"
    on public.messages for insert
    to authenticated
    with check (
      auth.uid() = sender_id
      and (receiver_id is not null or (group_id is not null and exists (
        select 1 from public.group_chat_members where group_id = messages.group_id and member_id = auth.uid()
      )))
    );
exception when duplicate_object then null;
end $$;

-- ---------- REALTIME PUBLICATIONS ----------
drop publication if exists supabase_realtime;
create publication supabase_realtime;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.group_chats;
alter publication supabase_realtime add table public.group_chat_members;

-- ---------- STORAGE BUCKET ----------
insert into storage.buckets (id, name, public)
values ('chat-files', 'chat-files', true)
on conflict (id) do nothing;

-- Storage RLS Policies
do $$
begin
  create policy "Authenticated users can upload"
    on storage.objects for insert
    to authenticated
    with check (bucket_id = 'chat-files');
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "Anyone can view files"
    on storage.objects for select
    to public
    using (bucket_id = 'chat-files');
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "Users can delete their own files"
    on storage.objects for delete
    to authenticated
    using (bucket_id = 'chat-files' and owner = auth.uid());
exception when duplicate_object then null;
end $$;

-- ============================================================
-- Done! Your schema is ready to use.
-- ============================================================

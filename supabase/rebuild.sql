-- Failsafe Supabase rebuild for Nebula Chat
-- Run this in Supabase SQL Editor if public tables/policies were deleted.

-- 1) Ensure the public schema exists and the auth schema is available.
create schema if not exists public;

-- 2) Recreate profiles table and columns.
drop table if exists public.profiles cascade;
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  avatar_url text,
  pronouns text,
  bio text,
  status text not null default 'online' check (status in ('online', 'idle', 'dnd', 'offline')),
  status_message text,
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 3) Recreate friends table.
drop table if exists public.friends cascade;
create table public.friends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  constraint no_self_friend check (user_id <> friend_id),
  constraint unique_pair unique (user_id, friend_id)
);

-- 4) Recreate messages table.
drop table if exists public.messages cascade;
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

create index if not exists messages_conversation_idx
  on public.messages (least(sender_id, receiver_id), greatest(sender_id, receiver_id), created_at);

-- 5) Recreate RLS and policies.
alter table public.profiles enable row level security;
alter table public.friends enable row level security;
alter table public.messages enable row level security;

drop policy if exists "Profiles are viewable by any authenticated user" on public.profiles;
drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;

drop policy if exists "Users can view relationships involving them" on public.friends;
drop policy if exists "Users can send friend requests" on public.friends;
drop policy if exists "Either party can update a relationship (accept/block)" on public.friends;
drop policy if exists "Either party can delete/decline a relationship" on public.friends;

drop policy if exists "Users can view messages they sent or received" on public.messages;
drop policy if exists "Users can send messages as themselves" on public.messages;
drop policy if exists "Users can update their own messages" on public.messages;
drop policy if exists "Users can delete their own messages" on public.messages;

create policy "Profiles are viewable by any authenticated user"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

create policy "Users can view relationships involving them"
  on public.friends for select
  to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_id);

create policy "Users can send friend requests"
  on public.friends for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Either party can update a relationship (accept/block)"
  on public.friends for update
  to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_id);

create policy "Either party can delete/decline a relationship"
  on public.friends for delete
  to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_id);

create policy "Users can view messages they sent or received"
  on public.messages for select
  to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

create policy "Users can send messages as themselves"
  on public.messages for insert
  to authenticated
  with check (auth.uid() = sender_id);

create policy "Users can update their own messages"
  on public.messages for update
  to authenticated
  using (auth.uid() = sender_id);

create policy "Users can delete their own messages"
  on public.messages for delete
  to authenticated
  using (auth.uid() = sender_id);

-- 6) Recreate the trigger function for profile auto-creation.
drop function if exists public.handle_new_user() cascade;
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'username',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 7) Re-enable realtime for messages and profiles.
drop publication if exists supabase_realtime;
create publication supabase_realtime;

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.profiles;

-- 8) Recreate storage bucket and policies.
insert into storage.buckets (id, name, public)
values ('chat-files', 'chat-files', true)
on conflict (id) do nothing;

drop policy if exists "Authenticated users can upload chat files" on storage.objects;
drop policy if exists "Anyone can view chat files (public bucket)" on storage.objects;
drop policy if exists "Users can delete their own uploaded files" on storage.objects;

create policy "Authenticated users can upload chat files"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'chat-files');

create policy "Anyone can view chat files (public bucket)"
  on storage.objects for select
  to public
  using (bucket_id = 'chat-files');

create policy "Users can delete their own uploaded files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'chat-files' and owner = auth.uid());

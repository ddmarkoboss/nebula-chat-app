# Nebula Chat

A real-time chat app built with **Next.js 14** (App Router) and **Supabase**
(Auth + Postgres + Realtime + Storage).

Features:
- Email/password **signup** and **login**
- **Add friends** by username, accept/decline friend requests
- **Real-time 1:1 messaging** (Supabase Realtime, no refresh needed)
- **File uploads** (images, PDFs, any file) attached to messages, stored in Supabase Storage
- Sleek dark UI (Tailwind CSS), protected routes via middleware

---

## 1. Set up the database

1. Go to your Supabase project → **SQL Editor**.
2. Open `supabase/schema.sql` from this project, paste the whole thing in, and click **Run**.
   This creates:
   - `profiles` table (+ a trigger that auto-creates a profile when someone signs up)
   - `friends` table (friend requests / accepted friendships)
   - `messages` table (with Realtime enabled)
   - a public `chat-files` Storage bucket with upload/read policies

3. (Recommended while testing) In **Authentication → Providers → Email**, turn
   **"Confirm email"** OFF so new accounts can log in immediately without checking email.
   The signup page already handles both cases — it shows "check your email" if
   confirmation is required.

## 2. Environment variables

`.env.local` is already filled in:

```
NEXT_PUBLIC_SUPABASE_URL=https://bwcnllhflumxdwuqxmjc.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_I-GqjwWmFsGRBr-VQ6pS2A_ZBfSsvTt
```

This is a **publishable/anon** key, safe to expose in the browser — data access is
protected by the Row Level Security policies in `schema.sql`, not by secrecy of the key.

## 3. Install & run

```bash
npm install
npm run dev
```

Open http://localhost:3000 — you'll be redirected to `/login`.

## 4. Build for production

```bash
npm run build
npm start
```

---

## Project structure

```
app/
  login/page.tsx          Login page
  signup/page.tsx          Signup page (creates auth user + profile)
  chat/page.tsx             Server component: loads current user, friends, requests
  chat/ChatClient.tsx        Client component: chat UI (realtime, upload, friends)
  page.tsx                   Redirects "/" to /chat or /login
middleware.ts               Protects /chat, redirects logged-in users away from auth pages
utils/supabase/
  client.ts                  Browser Supabase client
  server.ts                   Server component Supabase client
  middleware.ts                Middleware Supabase client (refreshes session cookies)
supabase/schema.sql            Full DB schema — run once in the Supabase SQL editor
```

## How it works

- **Auth**: Supabase Auth (email/password). On signup, a Postgres trigger
  (`handle_new_user`) auto-creates a matching row in `profiles` with the chosen username.
- **Friends**: `friends` table stores one row per relationship with `status` of
  `pending` or `accepted`. Search by username, send a request, the other person accepts
  it from their sidebar.
- **Messages**: stored in `messages` (sender_id, receiver_id, content, optional file_url).
  The chat window subscribes to Postgres Realtime `INSERT` events so new messages appear
  instantly for both users without polling or refreshing.
- **File uploads**: files go to the public `chat-files` bucket under
  `{user_id}/{timestamp}-{filename}`, and the public URL is saved on the message row.

## Notes / possible next steps

- Any authenticated user can currently look up any other user's `profiles` row (needed
  for username search) — tighten the `profiles` select policy in `schema.sql` if you
  want different search visibility rules.
- Only 1:1 chat is included, not group chats — the schema is small enough to extend.
- If you deploy (e.g. Vercel), set the two env vars there too.

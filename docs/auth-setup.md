# Supabase Auth Setup (Email + Google + Account Approval)

Configure your Supabase project after deploying migration `006_profiles_auth_approval.sql`.

## 1. Apply database migration

Run the SQL in [migrations/006_profiles_auth_approval.sql](../migrations/006_profiles_auth_approval.sql) in the Supabase SQL Editor (or your migration pipeline) for **each** Supabase project (source and replica).

This creates:

- `public.profiles` with `pending` / `approved` / `suspended` status
- Trigger to auto-create a **pending** profile on every new signup
- Backfill of existing `auth.users` as **approved**

## 2. Enable Email auth

In **Authentication → Providers → Email**:

1. Enable **Email** provider
2. Enable **Confirm email** (recommended for production)
3. Set minimum password length (8+; match frontend validation)
4. Enable **Leaked password protection** if available on your plan

## 3. Google OAuth (existing)

In **Authentication → Providers → Google**:

1. Enable Google
2. Add OAuth client ID/secret from Google Cloud Console
3. Add authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`

In Google Cloud Console → Credentials → OAuth client:

- **Authorized JavaScript origins**: your app URL (e.g. `http://localhost:5173`, production domain)
- **Authorized redirect URIs**: Supabase callback above

## 4. Site URL and redirect allowlist

In **Authentication → URL Configuration**:

| Setting | Example (local) | Example (production) |
|---------|-----------------|----------------------|
| Site URL | `http://localhost:5173` | `https://your-app.example.com` |
| Redirect URLs | `http://localhost:5173/**` | `https://your-app.example.com/**` |

These URLs are used for:

- Google OAuth return
- Email confirmation links
- Password reset links (`type=recovery` in URL hash)

The frontend uses PKCE and `detectSessionInUrl` — no custom auth callback route is required.

## 5. Email templates (optional)

Under **Authentication → Email Templates**, customize:

- **Confirm signup** — explain that admin approval is required after email confirmation
- **Reset password** — link returns user to the app to set a new password

## 6. Account approval workflow

1. User signs up (email/password or Google) → `profiles.status = pending`
2. User confirms email (if enabled) and signs in → sees **Approval pending** screen
3. Workspace **owner** or **admin** opens **Users** in AI Admin → **Approve**
4. Backend sets `status = approved`, adds user to `default` workspace as `member`
5. User clicks **Check approval status** or signs in again → full app access

Suspended users receive `403 ACCOUNT_SUSPENDED` on API calls and see a suspended message in the UI.

## 7. Security notes

- Profile writes use the **service role** on the backend only; RLS allows users to read their own profile
- JWT requests are blocked in `authMiddleware` until `profiles.status = approved`
- Admin user APIs require workspace `owner` or `admin` role (`requireRole` middleware)
- `/api/auth/*` routes (including bootstrap) remain public for pending users to check status

## 8. Apple / Facebook (deferred)

The frontend exposes a generic `signInWithOAuth(provider)` helper. To add Apple or Facebook later:

1. Enable the provider in Supabase Auth
2. Complete provider developer console setup
3. Add redirect URLs to the allowlist
4. Add a button in `AuthLanding.tsx` calling `signInWithOAuth('apple')` or `'facebook'`

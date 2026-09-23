# FINDOLLAR

FINDOLLAR is a cross-platform personal finance tracker and planner built as a progressive web app. The client uses React, TypeScript, Vite, and Tailwind CSS; Supabase provides authentication, PostgreSQL, storage, Row Level Security, and Edge Functions.

## Features

- Accounts, balances, income, expenses, transfers, categories, and statistics
- Debt tracking with history and linked account transactions
- Plans, notes, goals, recurring items, reminders, priorities, and calendar views
- Multiple locally saved FINDOLLAR accounts with isolated sessions and device settings
- Background Web Push notifications with per-account subscription controls
- Light and dark themes, installable PWA shell, and responsive mobile/desktop layouts
- Supabase RLS policies that isolate each account's data

## Requirements

- Node.js 22 or newer
- npm
- A Supabase project

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local environment file from the safe template:

   ```bash
   cp .env.example .env.local
   ```

3. Configure the public browser variables in `.env.local`:

   ```text
   VITE_SUPABASE_URL=
   VITE_SUPABASE_ANON_KEY=
   VITE_WEB_PUSH_PUBLIC_KEY=
   ```

   Vite variables are public client configuration. Never place a Supabase service-role key, a VAPID private key, access tokens, or other server secrets in a `VITE_` variable.

4. Start the development server:

   ```bash
   npm run dev
   ```

## Quality checks

```bash
npm test
npm run build
```

The production build includes TypeScript validation and creates the Vite PWA output in `dist/`.

## Supabase

Database migrations live in `supabase/migrations/` and should be applied in order to a new environment. Existing environments should receive only migrations that are not already recorded.

Edge Function source is version-controlled under `supabase/functions/`:

- `delete-account` removes the authenticated account and its owned data.
- `fetch-rates` refreshes supported exchange rates.
- `planner-reminders` sends scheduled Web Push reminders.

The Web Push deployment sequence, required server-only secrets, and scheduler setup are documented in [`supabase/WEB_PUSH_DEPLOYMENT.md`](supabase/WEB_PUSH_DEPLOYMENT.md). Secret values belong in the deployment environment and must never be committed.

## Project structure

```text
public/                     PWA manifest, icons, and notification worker code
src/components/              Shared UI and planner components
src/context/                 Authentication, organization, planner, and theme state
src/hooks/                   Reusable application hooks
src/lib/                     Domain logic and browser/Supabase integrations
src/pages/                   Application routes
src/types/                   TypeScript domain and database types
supabase/functions/          Edge Function source
supabase/migrations/         Versioned database migrations
supabase/scheduler/          Scheduler setup source
tests/                       Automated regression tests
```

## Repository safety

Local environment files, build output, dependencies, Vercel state, caches, logs, and editor files are excluded by `.gitignore`. `.env.example` contains variable names only and is safe to commit.


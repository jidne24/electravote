# SUST GEB Alumni Election — Secure Voting Platform

## Overview
This project implements a secure, anonymous, tamper‑resistant voting system used for the SUST GEB Alumni Association Executive Committee Election 2025. The solution is serverless-style: frontend UI (Next.js) on Vercel and the core backend logic implemented in PostgreSQL (Supabase) via transactional stored procedures (RPC). Small server-side serverless endpoints are used for privileged operations such as admin authentication and sending emails.

## Tech stack
- Frontend: Next.js (React)
- Database / Backend logic: PostgreSQL (Supabase) — tables, Row Level Security (RLS), and stored procedures (RPC)
- Hosting: Vercel for the Next.js app; Supabase for database and auth
- Email: Manual
- Dev: Git + GitHub

## Key design principles
- All critical voting logic runs inside a single ACID database transaction (RPC) to guarantee correctness and prevent race conditions.
- Voters receive unique 4‑digit OTPs; OTP validation and the vote recording are performed server-side.
- Anonymous ballots: ballots can be stored without voter identifiers to preserve voter privacy.
- Secrets (admin password, service_role key, SMTP credentials) are kept server-side — never exposed to the client.

## High-level architecture
1. Voter list and OTPs stored in `voters` table.
2. Frontend collects email + OTP + candidate selection.
3. Frontend calls a database RPC `cast_vote(email, otp, candidate_id)` (or a server-side proxy) to record the vote.
4. RPC validates election state, locks the voter row (`SELECT ... FOR UPDATE`), inserts an anonymous ballot and marks the voter as voted — all within one transaction.
5. Admin-only operations run server-side (Next.js API routes or Supabase Edge Functions) and use server-only env vars.

## Database schema (excerpt)
- voters (id, email, otp, has_voted, voted_at, created_at)
- candidates (id, name, vote_count)
- ballots (id, candidate_id, created_at) — anonymous ballots recommended
- election_settings (id, status)

Example constraints:
- `email` unique on `voters`
- `otp` length check (4 characters)
- foreign key `ballots.candidate_id -> candidates.id`

## Setup and deployment (brief)
1. Create a Supabase project and run schema migrations (create tables and RPC).
2. Create a Vercel project and connect the GitHub repository.
3. Add environment variables in Vercel and Supabase (server-only keys in Vercel; client keys exposed as NEXT_PUBLIC_*).
4. Deploy Next.js app on Vercel; set allowed redirect URLs in Supabase auth to the Vercel domain.
5. Import `voters.csv` into Supabase `voters` table (leave timestamp and has_voted columns blank if DB defaults apply).

## Security & concurrency measures
- Vote recording is done inside a single database transaction to guarantee atomicity.
- `SELECT ... FOR UPDATE` locks the voter row to prevent concurrent votes (race conditions).
- Database constraints prevent duplicates and invalid data.
- RLS policies restrict direct table writes; privileged actions happen via RPCs or server-side functions.
- Admin authentication and email sending are done server-side; secrets never exposed to the browser.

## Testing & verification
- Use `verify_voters.py` to confirm OTP uniqueness and email integrity before sending invites.
- Perform load/concurrency testing against the RPC to ensure locking behavior works as intended (e.g., with a small Node script or pgbench).
- Backup database and enable Supabase logs; take a snapshot before election day.

## Further work (optional)
- Provide full SQL migration files and RLS policy definitions.
- Add audit logging for admin actions and RPC calls.
- Add server-side unit and integration tests.
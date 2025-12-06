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

## cast_vote RPC (concept)
This RPC encapsulates the voting logic and must run in a single transaction. Example outline:

```sql
CREATE OR REPLACE FUNCTION public.cast_vote(
  p_email text,
  p_otp text,
  p_candidate_id integer
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_voter_id uuid;
  v_has_voted boolean;
  v_status text;
BEGIN
  SELECT status INTO v_status FROM election_settings WHERE id = 1;
  IF v_status IS NULL OR v_status <> 'running' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Election is not running');
  END IF;

  SELECT id, has_voted INTO v_voter_id, v_has_voted
    FROM voters
    WHERE email = p_email AND otp = p_otp
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid email or code');
  END IF;

  IF v_has_voted THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Already voted');
  END IF;

  INSERT INTO ballots (candidate_id, created_at) VALUES (p_candidate_id, now());
  UPDATE voters SET has_voted = TRUE, voted_at = now() WHERE id = v_voter_id;

  RETURN jsonb_build_object('ok', true, 'message', 'Vote recorded');
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
```

## How the frontend calls the RPC
Direct client call (using the public anon key) — only if RLS and function checks are sufficient:
```js
const { data, error } = await supabase.rpc('cast_vote', {
  p_email: email,
  p_otp: otp,
  p_candidate_id: candidateId
});
```
Recommended approach: call a Next.js API route (server-side) which invokes the RPC with the Supabase service role key. This keeps sensitive flows and elevated privileges server-side.

## Important environment variables
- NEXT_PUBLIC_SUPABASE_URL (client)
- NEXT_PUBLIC_SUPABASE_ANON_KEY (client)
- SUPABASE_SERVICE_ROLE_KEY (server-only)
- ADMIN_PASSWORD (server-only; do not prefix with NEXT_PUBLIC_)

## Included scripts
- generate_voters.py — generate `voters.csv` from `f.txt`, generates unique 4-digit OTPs.
- verify_voters.py — verify CSV integrity, check OTP uniqueness, check for duplicate emails.
- send_emails.py — optional script to send emails via SMTP (reads SMTP credentials at runtime).

Place `f.txt` (one email per non-blank line; blank lines allowed) in the repo root and run the generator to produce `voters.csv`.

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
# Howie

A look-it-up-then-answer assistant for HOAs, condos and home-service businesses. Howie never answers from memory: every question becomes a search over the client's own documents, and the answer is written only from what the search returns.

**One deployment per client:** each client gets their own Supabase project, their own Cloudflare Pages project (from this same repo), and their own private Google Drive folder. Sign-up is invite-only.

```
Client's Drive folder (private, shared with the Howie service account)
        │  weekly sync, or "Sync now"
        ▼
functions/api/kb-ingest.ts → Gemini embeddings → Supabase (pgvector)
                                                      │
Browser ── /api/kb-ask ── embed question ── kb_match ─┘── Gemini writes 1–4 sentences
   │
   └── ElevenLabs agent calls the client tool ask_broker → same search → Howie speaks
```

## What's in this repo

| Path | What it is |
|---|---|
| `howie-schema.sql` | Database script. Paste into each client's Supabase SQL Editor. Safe to run twice. |
| `functions/api/kb-ask.ts` | Answer endpoint (text answer, or raw passages for voice), with the source file, page and passage |
| `functions/api/kb-file.ts` | Sends one library document to a signed-in user for the document panel |
| `functions/api/kb-ingest.ts` | Sync worker: reads Drive, chunks (1,800 chars, 200 overlap), embeds, saves. One document per call, chains up to 60 times |
| `functions/_lib/` | Gemini, Google Drive (service account), Supabase and chunking helpers |
| `src/` | The web app: sign-in, ask box, answer card, admin panel, voice button. English and Spanish |
| `public/_headers` | Security headers plus the microphone permission voice needs |
| `public/howie.svg` | Placeholder logo (replace with the final icon) |
| `docs/elevenlabs-agent.md` | Exact prompt, tool and security settings for Howie's voice |

## Set up (follow the Key Tracker spreadsheet for click-by-click steps)

1. Do the one-time accounts and keys once (Key Tracker tab).
2. Push this repo to a **private** GitHub repo named `howie`. Turn on secret scanning and push protection first.
3. For each client, follow the Client Steps tab: Supabase project, run `howie-schema.sql`, Cloudflare Pages project, variables, subdomain, first admin, then close sign-ups.

### Cloudflare Pages build settings

Framework preset **Vite** · Build command `npm run build` · Output directory `dist`

### Variables (Settings → Variables and Secrets), set before the first deploy

| Name | Type | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | Text | The client's Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Text | The **publishable** key (`sb_publishable_...`), public by design. Do not use the secret key |
| `GEMINI_API_KEY` | Secret | From AI Studio |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Secret | The whole JSON key file contents |
| `GEMINI_ANSWER_MODEL` | Text | Defaults to `gemini-3.6-flash`. If answers fail with "model not found", set this to the current Flash model name |
| `COMPANY_NAME` | Text | The client's name, used in Howie's instructions |

A change to a variable does nothing until you redeploy: Deployments → latest → ⋯ → Retry deployment.

## Local testing (optional)

```
cp .env.example .env     # fill in values; .env is git-ignored
npm install
npm run dev              # the front end only; /api endpoints need Cloudflare (use `npx wrangler pages dev dist` after a build)
npm run typecheck
```

## Known limits and things to check

- **Not yet run against live services.** The code compiles and the helpers are tested, but nothing here has been run against a real Supabase project, Gemini key, Google Drive or ElevenLabs agent. Expect a short debugging pass on the first deploy. Test in this order: sign in, sync three documents, ask a number question, then voice.
- **Document panel.** When Howie answers (typed or spoken), the source document opens beside the answer with the exact passage Howie used. PDFs open at the right page in Chrome, Edge and Firefox (Safari, including iPhone, opens at page 1). Google Docs, Slides and Sheets show as PDFs. Word files can't be shown inline, only downloaded, so prefer PDFs or Google Docs in the library. Files load through the signed-in site (`/api/kb-file`), so the Drive folder never has to be shared with board members.
- **Page numbers come from the sync.** Only PDFs read after this update know their pages. If a library was synced before, run `update public.kb_documents set drive_modified_at = null;` in the Supabase SQL Editor, then press **Sync now** to re-read everything.
- **Cloudflare plan.** The free Workers plan has a very small CPU budget per request; reading large PDFs or Word files can exceed it. If sync shows errors on big files, use the Workers Paid plan for the production projects.
- **Sheets** sync only their first tab as CSV. **PDFs** over 7 MB and images/video are found by name only ("card_only").
- **Weekly sync** runs from the database (Mondays 13:00 UTC) and needs the real site address in the schema's `kb_cron_sync` function.
- **Voice** needs the ElevenLabs agent set up exactly as in `docs/elevenlabs-agent.md`, especially the tool name `ask_broker` and "Wait for response" ON. The voice client library version is recent and was only type-checked, not run.
- **No 2FA** in this version, by design. Sign-up is closed, so only invited people can sign in. Add 2FA later if a client requires it.
- **Keep personal data out of the library.** Every signed-in user of a client's site can search every document in that client's folder. Do not put owner ledgers, violation records, IDs or anything with personal data in it.
- **Every 90 days:** rotate the Gemini key and the service account key (create new, update Cloudflare, redeploy, delete old).

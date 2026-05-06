# Nerd Privacy Portal

Static site for `privacy.nerdenterprises.com` — privacy preferences, privacy
policy, and terms of service. Built to live outside WordPress so legal pages
can be version-controlled and updated without WP overhead.

## What's in here

```
nerd-privacy/
├── index.html                     ← redirects to /preferences
├── preferences.html               ← DSAR (data rights request) form
├── policy.html                    ← Privacy Policy (placeholder for Rick's content)
├── tos.html                       ← Terms of Service (placeholder for Rick's content)
├── CNAME                          ← privacy.nerdenterprises.com
├── assets/
│   ├── styles.css                 ← Nerd-branded styles
│   ├── form.js                    ← form validation + submission
│   └── nerd-logo.png              ← logo
├── supabase/
│   └── functions/
│       └── submit-privacy-request/
│           └── index.ts           ← Edge Function (form submission handler)
└── README.md
```

## How it works

1. User visits `privacy.nerdenterprises.com/preferences`
2. They fill out the form and submit
3. Form posts JSON to the Supabase Edge Function `submit-privacy-request`
4. The function:
   - Validates the input
   - Creates a Notion page in the **Privacy Requests** database
   - Sends an internal notification to `privacy@nerdenterprises.com`
   - Sends a confirmation email to the requester (with reference number)
   - Returns `{ success, reference }` to the browser
5. User sees a success message with their reference number; team works the
   request from Notion

---

## Deployment — one-time setup

### Part 1 — Notion Database (already done, here for reference)

The **Privacy Requests** database lives in the Nerd Enterprises Notion workspace.

Required properties:

| Property             | Type           | Notes                                                  |
| -------------------- | -------------- | ------------------------------------------------------ |
| Title                | Title          | Auto-set by Edge Function                              |
| Name                 | Text           |                                                        |
| Email                | Email          |                                                        |
| Request Type         | Select         | Access / Correction / Deletion / Portability / Opt-out of Sale/Sharing / Limit Use of Sensitive Info / Other |
| Products             | Multi-select   | Clean Books / Clean 1099s / THA / 97 & Up / Nerd Enterprises Web / YouTube / Other |
| Description          | Text           |                                                        |
| Jurisdiction         | Select         | California / Virginia / Colorado / Connecticut / Utah / Texas / Other US / EU/UK / Canada / Other International / Unspecified |
| Current Customer     | Checkbox       |                                                        |
| Verification Consent | Checkbox       |                                                        |
| Status               | Select         | New / Verifying Identity / In Progress / Awaiting User Response / Completed / Rejected / Expired |
| Submitted At         | Date           | Includes time                                          |
| Response Due         | Date           |                                                        |
| Source IP            | Text           | Truncated to /24 for privacy                           |
| User Agent           | Text           |                                                        |
| Reference Number     | Text           | **Add this** if not already present                    |
| Internal Notes       | Text           | For team's working notes                               |
| Processed By         | Text           |                                                        |
| Linked Deletion Log  | URL            | Optional — links to data_deletion_log RPC entry        |

Database has been shared with the **Nerd Privacy Portal** Notion integration.

### Part 2 — GitHub repo + Pages

1. Create a new private GitHub repo: `nerd-privacy`
2. From the local working directory:
   ```bash
   cd nerd-privacy
   git init
   git add .
   git commit -m "Initial commit: privacy portal"
   git branch -M main
   git remote add origin git@github.com:<your-username>/nerd-privacy.git
   git push -u origin main
   ```
3. In GitHub: **Settings → Pages**
   - Source: Deploy from a branch
   - Branch: `main` / `/ (root)`
   - Click **Save**
4. Custom domain: enter `privacy.nerdenterprises.com` (the CNAME file in the
   repo will already match)
5. Enable **Enforce HTTPS** (may take a few minutes after DNS resolves)

### Part 3 — DNS at GoDaddy

In GoDaddy DNS for `nerdenterprises.com`, add:

| Type  | Name      | Value                           | TTL   |
| ----- | --------- | ------------------------------- | ----- |
| CNAME | `privacy` | `<your-username>.github.io`     | 1 hr  |

Wait 5–60 minutes for DNS to propagate. Verify with:
```bash
dig privacy.nerdenterprises.com +short
# should return the GitHub Pages IP
```

GitHub Pages will auto-provision a Let's Encrypt SSL cert once DNS resolves.

### Part 4 — Resend

You probably already have Resend set up for `cleanbooks.app` transactional
email. You'll need to **add `nerdenterprises.com` as a verified domain** so the
function can send from `privacy@nerdenterprises.com`.

1. Resend dashboard → **Domains** → **Add Domain** → `nerdenterprises.com`
2. Add the DKIM/SPF DNS records Resend provides to GoDaddy
3. Wait for verification (usually under 10 minutes)
4. Confirm `privacy@nerdenterprises.com` (or any address @nerdenterprises.com)
   can be used as a sender

### Part 5 — Supabase Edge Function

From your local Clean Books project working directory (or wherever your
Supabase CLI is set up):

1. Copy the function into your Supabase functions directory:
   ```bash
   cp -r nerd-privacy/supabase/functions/submit-privacy-request \
         <your-supabase-project>/supabase/functions/
   ```

2. **Set the secrets** (this is where the Notion token goes — never in chat,
   never in code, never in git):
   ```bash
   supabase secrets set NOTION_TOKEN="ntn_xxxxx" \
                        NOTION_DATABASE_ID="5f8c3ee2cd734245924c4241bde4b915" \
                        RESEND_API_KEY="re_xxxxx" \
                        --project-ref ckxlldrzbcxobkkuolvb
   ```
   Or in the Supabase dashboard: **Project Settings → Edge Functions → Secrets**

3. Deploy:
   ```bash
   supabase functions deploy submit-privacy-request \
     --project-ref ckxlldrzbcxobkkuolvb \
     --no-verify-jwt
   ```
   The `--no-verify-jwt` flag is important — this is a public-facing endpoint.
   Anonymous users (privacy requesters) need to be able to call it.

4. Note the function URL — it will be:
   ```
   https://ckxlldrzbcxobkkuolvb.supabase.co/functions/v1/submit-privacy-request
   ```
   This is already hard-coded in `assets/form.js` (`SUBMIT_ENDPOINT` constant).
   No change needed unless you change projects.

### Part 6 — Test end to end

1. Open `https://privacy.nerdenterprises.com/preferences`
2. Fill out the form with test data — use your own email
3. Submit
4. Verify:
   - Success message displays with reference number
   - New page appears in the Notion **Privacy Requests** database
   - Internal notification email arrives at `privacy@nerdenterprises.com`
   - Confirmation email arrives at the test email address
5. If anything fails, check Supabase **Edge Functions → Logs** for the function

---

## Updating policy and TOS content

When Rick provides content for the Privacy Policy and Terms of Service:

1. Open `policy.html` (or `tos.html`)
2. Find the comment block marked `PASTE RICK CITRON'S [...] CONTENT BELOW`
3. Replace the placeholder section between the comment markers with the actual
   content. Use `<h2>`, `<h3>`, `<p>`, `<ul>`, `<ol>` — the styles are already
   set up.
4. Update `[DATE TO BE FILLED]` in the policy header
5. Commit, push — Pages will auto-rebuild within a minute

---

## Updating form options

If you add a new product (e.g., Clean Forecasts launches), three places need
to be updated:

1. `preferences.html` — add a checkbox to the products fieldset
2. `supabase/functions/submit-privacy-request/index.ts` — add to the
   `VALID_PRODUCTS` array
3. Notion database — add the option to the **Products** multi-select

Same pattern for Request Type or Jurisdiction.

---

## Security notes

- **Notion integration token** — stored only in Supabase secrets. Never in this
  repo, never in client code, never in chat. If accidentally exposed: regenerate
  immediately at https://www.notion.so/profile/integrations
- **Resend API key** — same pattern.
- **CORS** — Edge Function only accepts requests from
  `https://privacy.nerdenterprises.com`. Direct API calls from other origins
  will be blocked at the browser level. (This isn't full anti-abuse, but it
  prevents casual cross-site form posts.)
- **Honeypot** — The form has a hidden `website` field that humans never see
  but bots autofill. Submissions with that field populated return a fake-success
  response (so the bot doesn't learn) but never actually create a Notion page.
- **IP truncation** — Source IP is recorded as `/24` (IPv4) or first 3 hextets
  (IPv6) for audit purposes without storing the full address.
- **Rate limiting** — Not implemented yet at the Edge Function level. If abuse
  becomes an issue, add a simple Redis/Postgres-backed rate limit (e.g., max
  5 submissions per IP per hour).

---

## Future additions

- **Cookie consent banner** — separate concern, use a CMP (Termly / Cookiebot /
  iubenda). Embed across nerdenterprises.com, books.nerdenterprises.com, and
  this site.
- **`process_data_deletion_request` RPC** in Super Banana — closes the loop
  from Notion request → super-admin processing → audit-logged anonymization.
  Tracked separately.
- **Rate limiting** — if/when abuse appears.
- **Analytics** — none currently. Plausible or Fathom would be the privacy-
  respecting picks if needed.

---

🧹 *Cleaned by Nerd Enterprises, Inc.*

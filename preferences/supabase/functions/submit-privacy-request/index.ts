// =====================================================
// Nerd Privacy Portal — Submit Privacy Request
// =====================================================
// Edge Function: receives DSAR submissions from
// privacy.nerdenterprises.com/preferences, validates,
// creates a Notion page, and sends notification emails.
//
// Deployed via:
//   supabase functions deploy submit-privacy-request \
//     --project-ref ckxlldrzbcxobkkuolvb --no-verify-jwt
//
// Required secrets (set via `supabase secrets set ...`):
//   NOTION_TOKEN          — Notion integration secret
//   NOTION_DATABASE_ID    — Privacy Requests db ID
//   RESEND_API_KEY        — Resend API key
// =====================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const ALLOWED_ORIGIN = "https://privacy.nerdenterprises.com";
const NOTIFY_EMAIL   = "privacy@nerdenterprises.com";
const FROM_EMAIL     = "privacy@nerdenterprises.com";
const FROM_NAME      = "Nerd Enterprises";

const NOTION_TOKEN       = Deno.env.get("NOTION_TOKEN")!;
const NOTION_DATABASE_ID = Deno.env.get("NOTION_DATABASE_ID")!;
const RESEND_API_KEY     = Deno.env.get("RESEND_API_KEY")!;

const VALID_REQUEST_TYPES = [
  "Access", "Correction", "Deletion", "Portability",
  "Opt-out of Sale/Sharing", "Limit Use of Sensitive Info", "Other",
];

const VALID_PRODUCTS = [
  "Clean Books", "Clean 1099s", "THA", "97 & Up",
  "Nerd Enterprises Web", "YouTube", "Other",
];

const VALID_JURISDICTIONS = [
  "California", "Virginia", "Colorado", "Connecticut",
  "Utah", "Texas", "Other US", "EU/UK", "Canada",
  "Other International", "Unspecified",
];

interface RequestPayload {
  name: string;
  email: string;
  request_type: string;
  products: string[];
  description: string;
  jurisdiction: string;
  current_customer: boolean;
  verification_consent: boolean;
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin":  ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
    "Access-Control-Max-Age":       "86400",
    "Vary":                         "Origin",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

function generateReferenceNumber(): string {
  const now = new Date();
  const year  = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day   = String(now.getUTCDate()).padStart(2, "0");
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // omitted I, O, 0, 1 for legibility
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `NRD-${year}-${month}${day}-${suffix}`;
}

function truncateIp(ip: string): string {
  if (!ip || ip === "unknown") return "unknown";
  if (ip.includes(":")) {
    // IPv6 → keep first 3 hextets, mask the rest
    const parts = ip.split(":");
    return parts.slice(0, 3).join(":") + "::xxxx";
  }
  // IPv4 → /24
  const parts = ip.split(".");
  if (parts.length !== 4) return "unknown";
  return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
}

function validate(p: Partial<RequestPayload>): string[] {
  const errors: string[] = [];

  if (!p.name || typeof p.name !== "string" || p.name.trim().length < 2) {
    errors.push("Name is required.");
  }
  if (p.name && p.name.length > 200) errors.push("Name is too long.");

  if (!p.email || typeof p.email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) {
    errors.push("A valid email address is required.");
  }

  if (!p.request_type || !VALID_REQUEST_TYPES.includes(p.request_type)) {
    errors.push("A valid request type is required.");
  }

  if (!Array.isArray(p.products) || p.products.length === 0) {
    errors.push("At least one product must be selected.");
  } else {
    const invalid = p.products.filter((x) => !VALID_PRODUCTS.includes(x));
    if (invalid.length) errors.push(`Invalid product(s): ${invalid.join(", ")}.`);
  }

  if (!p.description || typeof p.description !== "string" ||
      p.description.trim().length < 10) {
    errors.push("Description must be at least 10 characters.");
  }
  if (p.description && p.description.length > 5000) {
    errors.push("Description is too long (max 5000 characters).");
  }

  if (!p.jurisdiction || !VALID_JURISDICTIONS.includes(p.jurisdiction)) {
    errors.push("A valid jurisdiction is required.");
  }

  if (typeof p.current_customer !== "boolean") {
    errors.push("Current customer field is required.");
  }

  if (p.verification_consent !== true) {
    errors.push("Verification consent is required.");
  }

  return errors;
}

async function createNotionPage(
  payload: RequestPayload,
  refNum: string,
  ip: string,
  userAgent: string,
): Promise<{ url: string; id: string }> {
  const submittedAt = new Date();
  const responseDue = new Date(submittedAt.getTime() + 30 * 24 * 60 * 60 * 1000);

  const dateStr = submittedAt.toLocaleDateString("en-US", {
    year:  "numeric",
    month: "short",
    day:   "numeric",
  });
  const title = `${payload.request_type} — ${payload.name} — ${dateStr}`;

  const body = {
    parent: { database_id: NOTION_DATABASE_ID },
    properties: {
      "Title":                { title:     [{ text: { content: title } }] },
      "Name":                 { rich_text: [{ text: { content: payload.name } }] },
      "Email":                { email:     payload.email },
      "Request Type":         { select:    { name: payload.request_type } },
      "Products":             { multi_select: payload.products.map((p) => ({ name: p })) },
      "Description":          { rich_text: [{ text: { content: payload.description.slice(0, 2000) } }] },
      "Jurisdiction":         { select:    { name: payload.jurisdiction } },
      "Current Customer":     { checkbox:  payload.current_customer },
      "Verification Consent": { checkbox:  payload.verification_consent },
      "Status":               { select:    { name: "New" } },
      "Submitted At":         { date:      { start: submittedAt.toISOString() } },
      "Response Due":         { date:      { start: responseDue.toISOString().split("T")[0] } },
      "Source IP":            { rich_text: [{ text: { content: ip } }] },
      "User Agent":           { rich_text: [{ text: { content: userAgent.slice(0, 500) } }] },
      "Reference Number":     { rich_text: [{ text: { content: refNum } }] },
    },
  };

  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      "Authorization":  `Bearer ${NOTION_TOKEN}`,
      "Content-Type":   "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API error: ${res.status} ${text}`);
  }

  const data = await res.json();
  return { url: data.url, id: data.id };
}

async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}): Promise<void> {
  const body: Record<string, unknown> = {
    from:    `${FROM_NAME} <${FROM_EMAIL}>`,
    to:      [opts.to],
    subject: opts.subject,
    text:    opts.text,
  };
  if (opts.replyTo) body.reply_to = opts.replyTo;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Resend error (${opts.to}): ${res.status} ${text}`);
  }
}

function buildInternalEmail(
  payload: RequestPayload,
  refNum: string,
  notionUrl: string,
  ip: string,
): { subject: string; text: string } {
  const submittedAt = new Date();
  const responseDue = new Date(submittedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  const dueStr = responseDue.toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  const submittedStr = submittedAt.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    dateStyle: "long",
    timeStyle: "short",
  });
  const dateShort = submittedAt.toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });

  const subject = `[Privacy Request] ${payload.request_type} — ${payload.name} — ${dateShort}`;

  const verificationLine = payload.verification_consent
    ? "User consented to identity verification"
    : "NO CONSENT — flag for review";

  const text =
`A new privacy request has been submitted via privacy.nerdenterprises.com.

Reference:     ${refNum}
Request Type:  ${payload.request_type}
Submitted:     ${submittedStr} PT
Response Due:  ${dueStr} (30 days)

From:             ${payload.name} <${payload.email}>
Products:         ${payload.products.join(", ") || "None specified"}
Jurisdiction:     ${payload.jurisdiction}
Current Customer: ${payload.current_customer ? "Yes" : "No"}

Description:
"${payload.description}"

──────────────────────────────────
Verification: ${verificationLine}
Source IP:    ${ip}
──────────────────────────────────

▸ Open in Notion: ${notionUrl}

Reminder: Response window closes ${dueStr}.

— Nerd Privacy Portal`;

  return { subject, text };
}

function buildUserConfirmation(
  payload: RequestPayload,
  refNum: string,
): { subject: string; text: string } {
  const submittedAt = new Date();
  const submittedStr = submittedAt.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    dateStyle: "long",
    timeStyle: "short",
  });

  const firstName = payload.name.split(" ")[0] || payload.name;

  const subject = "We received your privacy request — Nerd Enterprises";

  const text =
`Hi ${firstName},

Thanks for reaching out. We've received your request and logged it in our system. Here's what happens next:

  • A team member will review your request within 5 business days.
  • If we need to verify your identity, we'll reach out by reply to this email. (Verification helps protect your account from unauthorized requests.)
  • We'll complete your request within 30 days. If we need additional time — which is rare — we'll let you know in writing why and when to expect resolution.

Your reference number: ${refNum}
Type of request:       ${payload.request_type}
Submitted:             ${submittedStr} PT

If you didn't submit this request, please reply to this email immediately and we'll investigate.

For our full Privacy Policy, visit:
https://privacy.nerdenterprises.com/policy

Thanks,
The Nerd Enterprises team

—
Nerd Enterprises, Inc.
privacy.nerdenterprises.com
This message was sent because a privacy request was submitted with this email address.`;

  return { subject, text };
}

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let payload: Partial<RequestPayload> & { website?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  // Honeypot — bots fill the hidden "website" field. Pretend success.
  if (typeof payload.website === "string" && payload.website.length > 0) {
    return jsonResponse({ success: true, reference: "NRD-IGNORED" });
  }

  const errors = validate(payload);
  if (errors.length > 0) {
    return jsonResponse({ error: "Validation failed", details: errors }, 400);
  }

  const validated = payload as RequestPayload;

  // Metadata for audit trail
  const ipRaw = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
                req.headers.get("x-real-ip") || "unknown";
  const ip = truncateIp(ipRaw);
  const userAgent = req.headers.get("user-agent") || "unknown";

  const refNum = generateReferenceNumber();

  // 1. Create the Notion page (this is the source of truth — must succeed)
  let notionUrl: string;
  try {
    const result = await createNotionPage(validated, refNum, ip, userAgent);
    notionUrl = result.url;
  } catch (err) {
    console.error("Notion page creation failed:", err);
    return jsonResponse({
      error: "We couldn't process your request right now. Please try again, or email privacy@nerdenterprises.com directly.",
    }, 500);
  }

  // 2. Send notification + confirmation emails (don't block on failure)
  const internal = buildInternalEmail(validated, refNum, notionUrl, ip);
  const confirm  = buildUserConfirmation(validated, refNum);

  await Promise.allSettled([
    sendEmail({
      to:      NOTIFY_EMAIL,
      subject: internal.subject,
      text:    internal.text,
    }),
    sendEmail({
      to:      validated.email,
      subject: confirm.subject,
      text:    confirm.text,
      replyTo: NOTIFY_EMAIL,
    }),
  ]);

  return jsonResponse({ success: true, reference: refNum });
});

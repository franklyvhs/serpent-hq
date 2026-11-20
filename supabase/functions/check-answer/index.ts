// ============================================================
// SERPENT HQ — check-answer Edge Function (Deno)
// Deploy: supabase functions deploy check-answer
// Required secrets (names may NOT start with SUPABASE_):
//   ANON_KEY  (publishable/anon key from Settings → API)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
// Client: { slug, answer } + Authorization: Bearer <jwt>
// Returns: { correct, points?, firstSolve?, error? }
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("ANON_KEY") ?? "";

console.log("env check: url?", !!SUPABASE_URL, "service key length:", SERVICE_KEY.length, "anon key length:", ANON_KEY.length);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const RATE_LIMIT = { maxAttempts: 12, windowSeconds: 300 };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: "unauthorized" }, 401);
  }
  const profileId = userData.user.id;

  let body: { slug?: string; answer?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad request" }, 400);
  }
  const slug = String(body.slug ?? "");
  const answer = String(body.answer ?? "");
  if (!slug || !answer) {
    return json({ error: "slug and answer required" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Rate limit.
  const since = new Date(Date.now() - RATE_LIMIT.windowSeconds * 1000).toISOString();
  const { count } = await admin
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .gte("submitted_at", since);
  if ((count ?? 0) >= RATE_LIMIT.maxAttempts) {
    return json({ error: "rate limited, slow down Agent" }, 429);
  }

  // Lookup 1: the secret answer row. Distinct error if missing,
  // so we can tell seeding problems apart from metadata problems.
  const { data: row, error: rowErr } = await admin
    .from("contract_answers")
    .select("answer_hash, alias_hashes")
    .eq("contract_slug", slug)
    .maybeSingle();
  if (rowErr) {
    console.log("answers query error:", rowErr.message);
    return json({ error: "answer lookup failed: " + rowErr.message }, 500);
  }
  if (!row) {
    console.log("answers row missing for slug=" + slug + " (service key len " + SERVICE_KEY.length + ")");
    return json({ error: "no answer seeded for this contract" }, 404);
  }

  // Lookup 2: contract metadata (points + enabled).
  const { data: contract, error: cErr } = await admin
    .from("contracts")
    .select("points, enabled")
    .eq("slug", slug)
    .maybeSingle();
  if (cErr) {
    console.log("contracts query error:", cErr.message);
    return json({ error: "contract lookup failed: " + cErr.message }, 500);
  }
  if (!contract?.enabled) {
    return json({ error: "contract metadata missing" }, 404);
  }

  const guess = await sha256Hex(normalize(answer));
  const hashes: string[] = [row.answer_hash, ...JSON.parse(row.alias_hashes ?? "[]")];
  const correct = hashes.includes(guess);

  if (correct) {
    const { data: existing } = await admin
      .from("submissions")
      .select("id")
      .eq("profile_id", profileId)
      .eq("contract_slug", slug)
      .eq("correct", true)
      .maybeSingle();
    if (existing) {
      return json({ correct: true, firstSolve: false });
    }
    await admin.from("submissions").insert({
      profile_id: profileId,
      contract_slug: slug,
      correct: true,
    });
    return json({ correct: true, points: contract.points, firstSolve: true });
  }

  // Log failed attempt (rate limiting + hint gating).
  await admin.from("submissions").insert({
    profile_id: profileId,
    contract_slug: slug,
    correct: false,
  });

  return json({ correct: false });
});

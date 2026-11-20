// ============================================================
// SERPENT HQ — check-answer Edge Function (Deno)
// Deploy: supabase functions deploy check-answer
// Required secrets (set via `supabase secrets set` or the dashboard):
//   SUPABASE_SERVICE_ROLE_KEY  (injected automatically by Supabase)
//   SUPABASE_ANON_KEY           (from Settings → API)
// Client sends: { slug, answer } with an Authorization: Bearer <jwt>
// Returns: { correct, points?, firstSolve?, error? }
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const RATE_LIMIT = { maxAttempts: 12, windowSeconds: 300 };

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405 });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  // Verify the caller's JWT by using it as the client's auth:
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }
  const profileId = userData.user.id;

  let body: { slug?: string; answer?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
  }
  const slug = String(body.slug ?? "");
  const answer = String(body.answer ?? "");
  if (!slug || !answer) {
    return new Response(JSON.stringify({ error: "slug and answer required" }), { status: 400 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Rate limit: count this user's submissions in the recent window.
  const since = new Date(Date.now() - RATE_LIMIT.windowSeconds * 1000).toISOString();
  const { count } = await admin
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .gte("submitted_at", since);
  if ((count ?? 0) >= RATE_LIMIT.maxAttempts) {
    return new Response(JSON.stringify({ error: "rate limited, slow down Agent" }), { status: 429 });
  }

  // Fetch the secret answer row (service role bypasses RLS).
  const { data: row } = await admin
    .from("contract_answers")
    .select("answer_hash, alias_hashes")
    .eq("contract_slug", slug)
    .maybeSingle();
  if (!row) {
    return new Response(JSON.stringify({ error: "unknown contract" }), { status: 404 });
  }

  // Also load the contract for points + enabled flag.
  const { data: contract } = await admin
    .from("contracts")
    .select("points, enabled")
    .eq("slug", slug)
    .maybeSingle();
  if (!contract?.enabled) {
    return new Response(JSON.stringify({ error: "unknown contract" }), { status: 404 });
  }

  const guess = await sha256Hex(normalize(answer));
  const hashes: string[] = [row.answer_hash, ...JSON.parse(row.alias_hashes ?? "[]")];
  const correct = hashes.includes(guess);

  let alreadySolved = false;
  if (correct) {
    const { data: existing } = await admin
      .from("submissions")
      .select("id")
      .eq("profile_id", profileId)
      .eq("contract_slug", slug)
      .eq("correct", true)
      .maybeSingle();
    alreadySolved = !!existing;
    if (!alreadySolved) {
      await admin.from("submissions").insert({
        profile_id: profileId,
        contract_slug: slug,
        correct: true,
      });
      return Response.json({ correct: true, points: contract.points, firstSolve: true });
    }
    return Response.json({ correct: true, firstSolve: false });
  }

  // Log failed attempt (used for rate limiting + hint gating client-side).
  await admin.from("submissions").insert({
    profile_id: profileId,
    contract_slug: slug,
    correct: false,
  });

  return Response.json({ correct: false, firstSolve: false });
});

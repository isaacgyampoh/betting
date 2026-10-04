import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const SITE = process.env.SITE ?? "https://gameclaw.win";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>/^[A-Z]/.test(l)).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1).replace(/^"|"$/g,"")]}));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SERVICE_KEY, { auth: { persistSession: false } });
const email = `flow-${randomBytes(4).toString("hex")}@example.com`;
const password = "Flowtest!2026";
const { data: created } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
const id = created.user.id;
// 18+ and admin, so plan limits do not get in the way of the measurement.
const { Client } = await import("pg");
const db = new Client({ connectionString: env.DIRECT_URL });
await db.connect();
await db.query(`update profiles set age_confirmed_at = now(), role = 'ADMIN' where id = $1`, [id]);
const sess = await (await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
})).json();

const ask = async (text, messages = []) => {
  const t = Date.now();
  const res = await fetch(`${SITE}/api/v1/ai/chat`, {
    method: "POST",
    headers: { authorization: `Bearer ${sess.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ messages: [...messages, { role: "user", content: text }] }),
  });
  const body = await res.json();
  console.log(`\n"${text}"  -> ${res.status} in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  if (!res.ok) { console.log("  ", JSON.stringify(body).slice(0, 300)); return null; }
  const d = body.data;
  console.log("   reply:", String(d.reply ?? "").replace(/\s+/g, " ").slice(0, 220));
  console.log("   slips:", (d.slips ?? []).map((s) => `${s.code ?? "no code"} ${s.selections?.length ?? 0} legs @ ${s.totalOdds}`).join(" | ") || "none");
  const withReason = (d.slips ?? []).flatMap((s) => s.selections ?? []).filter((x) => x.reason).length;
  const legs = (d.slips ?? []).flatMap((s) => s.selections ?? []).length;
  if (legs) console.log(`   reasons: ${withReason}/${legs}`);
  return d;
};

await ask(process.env.ASK ?? "Give me a 2 odds slip for today");
await db.query(`delete from slips where user_id = $1`, [id]);
await db.query(`delete from usage_logs where user_id = $1`, [id]);
await db.query(`delete from profiles where id = $1`, [id]);
await db.end();
await admin.auth.admin.deleteUser(id);

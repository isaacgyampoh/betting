// Latency baseline, taken before any migration and re-run after it.
//
//   node scripts/bench.mjs                                    # the Render API, the baseline
//   BENCH_BASE=https://api.gameclaw.win node scripts/bench.mjs  # the VPS, to compare
//
// Sequential and warm: one request per endpoint is discarded first, so a cold connection or a
// cold cache is not counted. The README records the baseline run. Comparing anything against it
// means running this against both origins, not reasoning about hardware.
const API = (process.env.BENCH_BASE ?? "https://gameclaw-api.onrender.com").replace(/\/$/, "");
const N = Number(process.env.BENCH_SAMPLES ?? 7);
const endpoints = [
  ["GET", "/api/v1/health"],
  ["GET", "/api/v1/matches"],
  ["GET", "/api/v1/matches?date=2026-11-02"],
  ["GET", "/api/v1/picks"],
  ["GET", "/api/v1/picks/track-record"],
  ["GET", "/api/v1/plans"],
  ["GET", "/api/v1/bookmakers"],
  ["GET", "/api/v1/competitions"],
  ["GET", "/api/v1/me"],            // 401, measures the auth path
];
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
console.log(`  ${API}`);
console.log(`  ${"endpoint".padEnd(38)}${"n".padEnd(4)}${"min".padEnd(8)}${"median".padEnd(9)}${"p90".padEnd(8)}${"max".padEnd(8)}bytes  status`);
for (const [method, path] of endpoints) {
  await fetch(`${API}${path}`, { method }).catch(() => {});   // warm-up, discarded
  const times = [];
  let status = 0, bytes = 0;
  for (let i = 0; i < N; i++) {
    const t = performance.now();
    try {
      const res = await fetch(`${API}${path}`, { method, headers: { accept: "application/json" } });
      const body = await res.arrayBuffer();
      times.push(performance.now() - t);
      status = res.status; bytes = body.byteLength;
    } catch { times.push(NaN); }
  }
  const ok = times.filter(Number.isFinite);
  const f = (v) => `${Math.round(v)}ms`.padEnd(8);
  console.log(`  ${path.padEnd(38)}${String(ok.length).padEnd(4)}${f(Math.min(...ok))}${f(pct(ok,0.5)).padEnd(9)}${f(pct(ok,0.9))}${f(Math.max(...ok))}${String(bytes).padEnd(7)}${status}`);
}

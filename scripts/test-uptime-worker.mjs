#!/usr/bin/env node
// Test af uptime-worker/worker.js uden netværk: morgenens start af
// hentningen, mailen når starten fejler, og alarm-logikken (NEDE / OK igen).
//
// Kør: node scripts/test-uptime-worker.mjs
//
// Workeren er eneste vej til, at butikkerne hentes om natten, og eneste alarm
// ved nedbrud. Den havde ingen test: en fejl dér opdages først, når siden står
// med gamle priser, eller når en alarm ikke kom.
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// Kopieres til .mjs, så importen virker uanset Node-version og package.json.
const copy = join(mkdtempSync(join(tmpdir(), "uptime-")), "worker.mjs");
copyFileSync(join(root, "uptime-worker", "worker.js"), copy);
const worker = await import(pathToFileURL(copy).href);

let failures = 0;
function check(ok, label) {
  console.log((ok ? "  OK    " : "  FEJL  ") + label);
  if (!ok) failures += 1;
}

function fakeEnv(extra = {}) {
  const store = new Map();
  const writes = [];
  return {
    store,
    writes,
    RESEND_API_KEY: "re_test",
    ALERT_EMAIL: "drift@example.com",
    GH_DISPATCH_TOKEN: "ghp_test",
    STATE: {
      async get(key, type) {
        const v = store.get(key);
        if (v === undefined) return null;
        return type === "json" ? JSON.parse(v) : v;
      },
      async put(key, value) { store.set(key, value); writes.push(key); },
      async delete(key) { store.delete(key); },
    },
    ...extra,
  };
}

// Falsk netværk: GitHub, Resend og selve siden.
const net = { github: 204, githubRuns: 0, resend: 200, site: {}, calls: [] };
const PAGE_OK = "<title>MadShopper</title>" + 'data-has-match="true"'.repeat(30);
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  net.calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
  const reply = (status, body, headers = {}) =>
    new Response(status === 204 ? null : body, { status, headers });
  if (url.includes("api.github.com") && url.includes("/runs?")) {
    return reply(net.github === 204 ? 200 : net.github, JSON.stringify({ total_count: net.githubRuns }));
  }
  if (url.includes("api.github.com")) return reply(net.github, net.github === 204 ? "" : "Bad credentials");
  if (url.includes("api.resend.com")) return reply(net.resend, "{}");
  for (const [part, status] of Object.entries(net.site)) {
    if (url.includes(part)) return reply(status, "fejl");
  }
  if (url.includes("dev.madshopper.dk")) return reply(404, "Not found");
  if (url.includes("/api/home")) return reply(200, '{"sections":[{"products":[{"id":1}]}]}');
  if (url.includes("/api/stores")) return reply(200, '{"stores":[{"key":"rema"}]}');
  return reply(200, PAGE_OK);
};
const mails = () => net.calls.filter((c) => c.url.includes("api.resend.com"));
const dispatches = (wf) => net.calls.filter((c) => c.url.includes(`${wf}/dispatches`));
// Workeren venter 20 sekunder før et fejlet tjek prøves igen. Ikke i testen.
const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, _ms, ...args) => realTimeout(fn, 0, ...args);
const quiet = console.error;
console.error = () => {};

const at = (iso) => Date.parse(iso);

console.log("Morgenens start af hentningen:");
{
  const env = fakeEnv();
  net.calls.length = 0;
  check(await worker.startMorning(env, at("2026-11-10T00:00:00Z")) === null,
    "før kl. 00:05 UTC startes intet (D1's skrivedøgn er lige skiftet)");
  check(await worker.startMorning(env, at("2026-11-09T23:30:00Z")) === null,
    "før UTC-midnat startes intet, selvom datoen er skiftet i Danmark");
  const r = await worker.startMorning(env, at("2026-11-10T00:05:00Z"));
  check(r === "startet (nat)" && dispatches("nightly-dispatcher.yml").length === 1,
    "tirsdag kl. 00:05 UTC startes nightly-dispatcher én gang");
  check(dispatches("nightly-dispatcher.yml")[0].body.inputs.slot === "nat"
    && dispatches("nightly-dispatcher.yml")[0].body.ref === "main", "med slot \"nat\" på main");
  check(await worker.startMorning(env, at("2026-11-10T00:10:00Z")) === null
    && dispatches("nightly-dispatcher.yml").length === 1, "næste tick samme dag starter ikke igen");
  const next = await worker.startMorning(env, at("2026-11-11T00:05:00Z"));
  check(next === "startet (nat)", "næste dag startes den igen");
  check(await worker.startMorning(fakeEnv(), at("2026-11-10T12:30:00Z")) === null,
    "efter kl. 12 dansk tid startes intet");
  check(await worker.startMorning(fakeEnv({ GH_DISPATCH_TOKEN: "" }), at("2026-11-10T00:05:00Z")) === null,
    "uden GitHub-nøgle gør workeren intet (GitHubs egen cron tager over)");
}

console.log("Fredag og lørdag venter på butikkernes nye uge:");
{
  const env = fakeEnv();
  net.calls.length = 0;
  net.githubRuns = 0;
  const first = await worker.startMorning(env, at("2026-11-13T00:05:00Z"));
  check(first === "klar-tjek startet" && dispatches("butikker-klar.yml").length === 1
    && dispatches("nightly-dispatcher.yml").length === 0,
    "fredag kl. 00:05 UTC startes klar-tjekket, ikke hentningen");
  await worker.startMorning(env, at("2026-11-13T00:10:00Z"));
  check(dispatches("butikker-klar.yml").length === 1, "klar-tjekket startes ikke igen efter 5 min");
  await worker.startMorning(env, at("2026-11-13T00:35:00Z"));
  check(dispatches("butikker-klar.yml").length === 2, "men igen efter 30 min");
  net.githubRuns = 1;
  const seen = await worker.startMorning(env, at("2026-11-13T05:00:00Z"));
  check(seen === "startet af klar-tjekket" && dispatches("nightly-dispatcher.yml").length === 0,
    "har klar-tjekket selv startet hentningen, starter workeren den ikke");
  net.githubRuns = 0;
  const late = fakeEnv();
  const forced = await worker.startMorning(late, at("2026-11-13T08:00:00Z"));
  check(forced === "startet (nat)", "kl. 09 dansk tid startes hentningen under alle omstændigheder");
}

console.log("Starten fejler (fx udløbet GitHub-nøgle):");
{
  const env = fakeEnv();
  net.calls.length = 0;
  net.github = 401;
  let t = at("2026-11-10T00:05:00Z");
  const tick = async (ms) => {
    try {
      await worker.startMorning(env, ms);
      return "ok";
    } catch (err) {
      return worker.morningFailed(env, ms, err);
    }
  };
  const r1 = await tick(t);
  check(r1 && r1.n === 1 && !r1.mailed && mails().length === 0, "første fejl giver ingen mail");
  check(!env.store.has("nat_morgen_v1"), "dagen er ikke markeret som startet, så næste tick prøver igen");
  check(await tick(t) === null && mails().length === 0, "dubletten af samme tick tæller ikke");
  const r2 = await tick(t += 300000);
  check(r2.n === 2 && mails().length === 0, "anden fejl giver ingen mail");
  const r3 = await tick(t += 300000);
  check(r3.n === 3 && r3.mailed && mails().length === 1, "tredje fejl i træk giver én mail");
  const mail = mails()[0].body;
  check(mail.subject.includes("kunne ikke startes") && mail.html.includes("401")
    && mail.to[0] === "drift@example.com" && mail.from.includes("alarm@madshopper.dk"),
    "mailen siger hvad der er galt og går til alarm-modtageren");
  await tick(t += 300000);
  await tick(t += 300000);
  check(mails().length === 1, "derefter ikke flere mails samme dag");
  net.github = 204;
  check(await tick(t += 300000) === "ok" && env.store.get("nat_morgen_v1") === "2026-11-10",
    "når GitHub svarer igen, startes hentningen");
  net.github = 401;
  const nextDay = await tick(at("2026-11-11T00:05:00Z"));
  check(nextDay && nextDay.n === 1 && mails().length === 1, "næste dag tælles der forfra");
  net.github = 204;
}

console.log("Kommer mailen ikke af sted, prøves den igen:");
{
  const env = fakeEnv();
  net.calls.length = 0;
  net.resend = 500;
  const err = new Error("GitHub svarede 401");
  let t = at("2026-11-10T00:05:00Z");
  for (let i = 0; i < 3; i += 1) await worker.morningFailed(env, t += 300000, err);
  check(mails().length === 1 && !JSON.parse(env.store.get("nat_fejl_v1")).mailed,
    "Resend svarer 500: mailen er ikke markeret som sendt");
  net.resend = 200;
  const again = await worker.morningFailed(env, t += 300000, err);
  check(again.mailed && mails().length === 2, "næste tick sender den");
}

console.log("Alarm ved nedbrud:");
{
  const env = fakeEnv();
  // Første kørsel sender en kvittering; den er ikke det, der testes her.
  let t = at("2026-11-10T10:00:00Z");
  await worker.check(env, t);
  net.calls.length = 0;
  env.writes.length = 0;
  await worker.check(env, t += 300000);
  await worker.check(env, t += 300000);
  check(mails().length === 0 && env.writes.length === 0, "alt OK: ingen mail og ingen skrivning til KV");

  net.site = { "/Mejeri": 500 };
  await worker.check(env, t += 300000);
  // Cloudflare kører cron'en to gange pr. tick, ofte fra to datacentre. Den
  // anden må ikke tælle fejlen en gang til (eller nulstille den).
  net.site = {};
  const dup = await worker.check(env, t);
  net.site = { "/Mejeri": 500 };
  check(dup.skipped === "dublet", "anden kørsel i samme tick gør intet, når den første har gemt en fejl");
  await worker.check(env, t += 300000);
  check(mails().length === 0, "to fejl i træk giver ingen mail");
  await worker.check(env, t += 300000);
  check(mails().length === 1 && mails()[0].body.subject.startsWith("MadShopper NEDE: Kategoriside"),
    "tredje fejl i træk giver én NEDE-mail");
  await worker.check(env, t += 300000);
  check(mails().length === 1, "stadig nede: ingen ny mail");
  net.site = {};
  await worker.check(env, t += 300000);
  check(mails().length === 1, "første OK giver ingen mail");
  await worker.check(env, t += 300000);
  check(mails().length === 2 && mails()[1].body.subject === "MadShopper er OK igen",
    "anden OK i træk giver én OK-mail");

  // Den friske søgning kører kun hver anden time om dagen.
  net.calls.length = 0;
  await worker.check(env, at("2026-11-10T12:40:00Z"));
  const searched = net.calls.filter((c) => c.url.includes("/search/results")).length;
  await worker.check(env, at("2026-11-10T13:40:00Z"));
  await worker.check(env, at("2026-11-11T02:40:00Z"));
  check(searched === 1 && net.calls.filter((c) => c.url.includes("/search/results")).length === 1,
    "frisk søgning kl. 12:40 UTC, men ikke kl. 13:40 eller om natten");
}

console.error = quiet;
if (failures) {
  console.log(`\n${failures} FEJL`);
  process.exit(1);
}
console.log("\nALLE TESTS BESTAAET");

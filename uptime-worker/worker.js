// MadShopper uptime-tjek: en lille, selvstændig JS-worker med en cron trigger
// hvert 5. minut (gratis plan). Erstatter det slettede uptime-check.yml,
// som i praksis kun kørte hver 2.-6. time (GitHub-cron), så et nedbrud kunne
// gå uopdaget i timer. En worker-fetch bliver ikke stoppet af Bot Fight Mode
// (målt 02-10-2026), så der skal ingen rigtig browser til.
//
// Bevidst IKKE en del af src/worker.py: hovedworkeren er Python/Pyodide, og
// enhver ekstra kode dér deler CPU og den skrøbelige JS/Python-bro med
// brugernes requests. Denne worker har ingen route, ingen offentlig url og
// rører hverken D1 eller Supabase.
//
// Budget: kun sider der ligger i edge-cachen (forside, kategori, /api/home,
// /api/stores) plus dev-sidens 404, så hvert tjek koster et cache-hit,
// ikke en render. Den friske søgning er undtagelsen og kører hver 2. time
// (se SEARCH_CHECK): en ucachet søgning er en D1-tabelscanning på ~19k
// rows_read, og 288 af dem i døgnet sprænger gratisplanens 5M. Ventetid på
// svar tæller ikke mod CPU-grænsen på 10 ms.
//
// Alarm: én mail via Resend (samme konto og afsender som prisalarmerne) når et
// tjek har fejlet 3 gange i træk, og én når det har været OK 2 gange i træk
// (se FAIL_RUNS). Tilstanden ligger i KV og skrives kun når en tæller
// flytter sig, så normal drift koster 0 KV-skrivninger
// (kontoens gratis loft er 1.000 i døgnet, delt med nattens seed).

const STATE_KEY = "uptime_state_v1";
// Et tjek skal fejle i FAIL_RUNS kørsler i træk (15 min), før der går en
// NEDE-mail, og være OK i OK_RUNS kørsler i træk (10 min), før der går en
// OK-mail. Ét enkelt hik giver ingen mail, og et reelt nedbrud giver præcis
// to: én når det starter og én når det er ovre.
const FAIL_RUNS = 3;
const OK_RUNS = 2;
// DUPLICATE: siden deployet 10-10-2026 11:27 UTC kører Cloudflare cron'en
// */5 to gange pr. tick, 10-15 sekunder fra hinanden og ofte fra to
// forskellige datacentre. Natten til 11-10-2026 var den ene kørsel i et
// datacenter hvor siden svarede 500 (DTW) og den anden i et hvor alt var OK,
// så tilstanden vippede ved hver kørsel og gav 32 mails på tre timer. Hver
// kørsel gemmer derfor sit tick, og en anden kørsel i samme tick gør intet.
const TICK_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 15000;
// Et fejlende tjek prøves igen efter en pause, før det tæller som nede. Én
// enkelt "travlt" (503 + X-MadShopper-Busy) eller et netværkshik må ikke give
// mail; to i træk med 20 sekunders mellemrum er et reelt problem.
const RETRY_DELAY_MS = 20000;

// Produktkort i HTML'en. Samme tærskler som scripts/playwright-uptime-check.mjs:
// under 10 kort er en tom/degraderet side, og under 20 % med butiksmatch er
// en Rema-only-cache (sund baseline er ~50 %+).
const MIN_PRODUCTS = 10;
const MIN_MATCH_RATIO = 0.2;

function productCards(body, needMatches) {
  const total = (body.match(/data-has-match="(?:true|false)"/g) || []).length;
  if (total < MIN_PRODUCTS) return `kun ${total} produktkort`;
  if (needMatches) {
    const matched = (body.match(/data-has-match="true"/g) || []).length;
    if (matched / total < MIN_MATCH_RATIO) {
      return `kun ${Math.round((matched / total) * 100)} % af ${total} kort har en butiksmatch`;
    }
  }
  return true;
}

// expect() returnerer true, false eller en fejltekst.
const CHECKS = [
  {
    name: "Forside",
    url: "https://madshopper.dk/",
    expect: (body) => body.includes("<title>MadShopper"),
  },
  {
    name: "Kategoriside (/Mejeri)",
    url: "https://madshopper.dk/Mejeri",
    expect: (body) => body.includes("MadShopper") && productCards(body, true),
  },
  {
    // Appens forside-API. En tom liste er præcis den fejl, statuskoden ikke
    // viser (D1-opslag fejler blødt med 200), så der skal være varer i svaret.
    name: "API /api/home",
    url: "https://madshopper.dk/api/home",
    expect: (body) => body.includes('"sections":[{') && body.includes('"products":[{'),
  },
  {
    name: "API /api/stores",
    url: "https://madshopper.dk/api/stores",
    expect: (body) => body.includes('"stores":[{'),
  },
  {
    // Dev er skjult som /admin: alle uden adgang får 404 (05-10-2026). Det
    // tjekker vi: workeren svarer, og spærringen er lukket. Netop denne sti
    // logger ingen sikkerhedshændelse (se _STAGING_PROBE_PATH i src/worker.py).
    // En 200 her betyder at dev står åben, og det er også en fejl.
    name: "Dev (dev.madshopper.dk) svarer og er lukket",
    url: "https://dev.madshopper.dk/staging-login",
    status: 404,
    expect: (body) => body.trim() === "Not found",
  },
];

// Frisk søgning: den eneste der går gennem render-vejen og D1 (de andre er
// cache-hits), og dermed den der fangede søgefejlen i september. Den unikke
// max_price gør url'en ny hver gang, så den aldrig rammer edge-cachen. Den
// koster en D1-tabelscanning (~19k rows_read), så den kører hver 2. time
// om dagen: 8 x 19k = ~150k af gratisplanens 5M rows_read i døgnet. Budgettet er
// allerede stramt (målt 30-09-2026: 6,1M; 02-10-2026: 4,7M kl. 19 UTC), så
// sæt ikke frekvensen op uden at måle først. Aldrig hvert 5. minut
// (288 x 19k = 5,5M alene).
const SEARCH_CHECK = {
  name: "Frisk søgning (mælk)",
  url: "https://madshopper.dk/search/results?q=m%C3%A6lk",
  fresh: true,
  // Kører kun hver 2. time, så to fejl i træk (to timer) er nok.
  failRuns: 2,
  okRuns: 1,
  expect: (body) => body.includes("MadShopper") && productCards(body, false),
};
const SEARCH_MINUTE = 40;
// Kun om dagen (06:40-20:40 UTC, 8 gange i døgnet). Om natten er kun tjekkene
// selv på siden i Nordamerika, og en frisk søgning (~100-800 ms CPU) oven i
// timevis af cache-hits i samme isolate fik Cloudflare til at stoppe den med
// 1102, hvorefter isolaten svarede 1101 på alt i timer: 08-10 og 09-10-2026
// kl. 00:40 i ORD, og efter at 00:40 blev sprunget over, 11-10-2026 kl. 02:40
// i DTW (Detroit) til 05:55. Ingen besøgende blev ramt, kun tjekkene. Om
// dagen er der rigtig trafik, og søgningen er gået fint hver gang.
const SEARCH_UTC_HOURS = { from: 6, to: 20 };

async function runCheck(check) {
  const started = Date.now();
  try {
    let url = check.url;
    if (check.fresh) {
      const u = new URL(url);
      u.searchParams.set("max_price", String(1000000 + (Date.now() % 1000000)));
      url = u.toString();
    }
    const headers = { "User-Agent": "MadShopper-Uptime/1.0 (+https://madshopper.dk)" };
    const resp = await fetch(url, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - started;
    const body = await resp.text();
    const wantStatus = check.status || 200;
    if (resp.status !== wantStatus) {
      const busy = resp.headers.get("X-MadShopper-Busy") ? " (travlt)" : "";
      return { ok: false, detail: `HTTP ${resp.status}${busy} efter ${ms} ms` };
    }
    if (resp.headers.get("X-Data-Degraded")) {
      return { ok: false, detail: `200 men degraderet (X-Data-Degraded) efter ${ms} ms` };
    }
    const verdict = check.expect(body);
    if (verdict !== true) {
      const why = typeof verdict === "string" ? verdict : "forventet indhold mangler";
      return { ok: false, detail: `${wantStatus} men ${why} (${body.length} bytes) efter ${ms} ms` };
    }
    return { ok: true, detail: `${wantStatus} på ${ms} ms` };
  } catch (err) {
    const ms = Date.now() - started;
    const what = err && err.name === "TimeoutError" ? `timeout efter ${TIMEOUT_MS} ms` : String(err);
    return { ok: false, detail: `${what} (${ms} ms)` };
  }
}

// Tjekkene køres ét ad gangen, aldrig samtidig. Ved et cache-skift (ny UTC-
// dato i cache-nøglen ved midnat, eller et cache_version-bump) er alle fire
// prod-sider kolde på én gang, og fire samtidige renders i samme isolate gav
// 1102 (CPU) efterfulgt af en isolate der svarede 1101 på hvert eneste tjek:
// målt 06-10-2026 02:20-08:10 UTC og 07-10-2026 00:05-00:50 UTC, begge gange
// startet af præcis et uptime-tick i Chicago (ORD). Ventetid tæller ikke mod
// workerens CPU, og cache-hits tager få ms, så det koster intet i drift.
async function runAll(checks) {
  const results = new Map();
  for (const c of checks) results.set(c.name, await runCheck(c));
  const failing = checks.filter((c) => !results.get(c.name).ok);
  if (failing.length) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    for (const c of failing) {
      const first = results.get(c.name);
      const again = await runCheck(c);
      results.set(c.name, again.ok ? again : { ok: false, detail: `${first.detail}; igen: ${again.detail}` });
    }
  }
  return results;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

async function sendMail(env, subject, lines) {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL) {
    console.error("uptime: RESEND_API_KEY eller ALERT_EMAIL mangler, ingen mail sendt:", subject);
    return false;
  }
  const html =
    `<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>` +
    `<p style="color:#888;font-size:12px">Sendt af madshopper-uptime (Cloudflare cron hvert 5. minut).</p>`;
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "MadShopper drift <alarm@madshopper.dk>",
        to: env.ALERT_EMAIL.split(",").map((s) => s.trim()).filter(Boolean),
        subject,
        html,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.error(`uptime: Resend svarede ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("uptime: mail fejlede:", String(err));
    return false;
  }
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString("da-DK", { timeZone: "Europe/Copenhagen" });
}

export async function check(env, scheduledTime = Date.now()) {
  let state = null;
  let firstRun = false;
  try {
    state = await env.STATE.get(STATE_KEY, "json");
    firstRun = state === null;
  } catch (err) {
    console.error("uptime: KV-læsning fejlede:", String(err));
  }
  const tick = Math.floor(scheduledTime / TICK_MS);
  // Cloudflare kører cron'en to gange pr. tick (se DUPLICATE). Har en kørsel
  // allerede gemt tilstand for dette tick, gør denne intet.
  if (state && state.tick === tick) return { skipped: "dublet", down: state.down || {} };

  const prevDown = (state && state.down) || {};
  const prevFails = (state && state.fails) || {};
  const prevOks = (state && state.oks) || {};

  const when = new Date(scheduledTime);
  const runSearch =
    when.getUTCMinutes() === SEARCH_MINUTE &&
    when.getUTCHours() % 2 === 0 &&
    when.getUTCHours() >= SEARCH_UTC_HOURS.from &&
    when.getUTCHours() <= SEARCH_UTC_HOURS.to;
  const checks = runSearch ? [...CHECKS, SEARCH_CHECK] : CHECKS;
  const allChecks = [...CHECKS, SEARCH_CHECK];

  const results = await runAll(checks);
  const now = new Date().toISOString();

  // Et tjek der ikke kørte denne gang (søgningen), beholder sin tilstand.
  const down = {};
  const fails = {};
  const oks = {};
  for (const c of allChecks) {
    if (checks.includes(c)) continue;
    if (prevDown[c.name]) down[c.name] = prevDown[c.name];
    if (prevFails[c.name]) fails[c.name] = prevFails[c.name];
    if (prevOks[c.name]) oks[c.name] = prevOks[c.name];
  }
  const newlyDown = [];
  const recovered = [];
  for (const c of checks) {
    const failRuns = c.failRuns || FAIL_RUNS;
    const okRuns = c.okRuns || OK_RUNS;
    if (!results.get(c.name).ok) {
      const f = prevFails[c.name] || { n: 0, since: now };
      fails[c.name] = { n: f.n + 1, since: f.since };
      if (prevDown[c.name]) down[c.name] = prevDown[c.name];
      else if (f.n + 1 >= failRuns) {
        down[c.name] = f.since;
        newlyDown.push(c);
      }
    } else if (prevDown[c.name]) {
      const n = (prevOks[c.name] || 0) + 1;
      if (n >= okRuns) recovered.push(c.name);
      else {
        down[c.name] = prevDown[c.name];
        oks[c.name] = n;
      }
    }
  }
  // Tjek der er fjernet fra listen, er ikke nede længere.
  for (const name of Object.keys(prevDown)) {
    if (!allChecks.some((c) => c.name === name)) recovered.push(name);
  }

  const newState = { down, fails, oks, tick, changed_at: now };
  const changed =
    JSON.stringify([down, fails, oks]) !== JSON.stringify([prevDown, prevFails, prevOks]);

  // Første kørsel efter deploy: én kvitteringsmail, så det er bevist at hele
  // vejen til indbakken virker, før der er brug for den.
  if (firstRun) {
    const lines = checks.map((c) => `${c.name}: ${results.get(c.name).detail}`);
    if (await sendMail(env, "MadShopper uptime-overvågning er aktiv", lines)) {
      await env.STATE.put(STATE_KEY, JSON.stringify(newState));
    }
  } else if (newlyDown.length || recovered.length) {
    const lines = [];
    for (const c of newlyDown) {
      lines.push(`NEDE: ${c.name} (${c.url}), fejlet ${fails[c.name].n} gange i træk siden ` +
        `${fmtTime(fails[c.name].since)}: ${results.get(c.name).detail}`);
    }
    for (const name of recovered) {
      const r = results.get(name);
      const detail = r ? r.detail : "tjekket findes ikke længere";
      lines.push(`OK igen: ${name}, nede siden ${fmtTime(prevDown[name])}: ${detail}`);
    }
    const stillDown = Object.keys(down).filter((n) => !newlyDown.some((c) => c.name === n));
    for (const name of stillDown) lines.push(`Stadig nede: ${name} siden ${fmtTime(down[name])}`);

    const subject = newlyDown.length
      ? `MadShopper NEDE: ${newlyDown.map((c) => c.name).join(", ")}`
      : Object.keys(down).length
        ? `MadShopper delvist OK igen: ${recovered.join(", ")}`
        : "MadShopper er OK igen";
    // Tilstanden gemmes kun når mailen er sendt: fejler Resend, prøves den
    // igen ved næste kørsel i stedet for at alarmen forsvinder i stilhed.
    if (await sendMail(env, subject, lines)) {
      await env.STATE.put(STATE_KEY, JSON.stringify(newState));
    }
  } else if (changed) {
    // Tælleren flyttede sig uden mail (fx første fejl). Normal drift, hvor
    // alt er OK og intet tæller, skriver intet til KV.
    await env.STATE.put(STATE_KEY, JSON.stringify(newState));
  }
  return { results: Object.fromEntries(results), down, fails, newlyDown: newlyDown.map((c) => c.name), recovered };
}

// Morgenens hentning af butikkerne. GitHubs egen cron kommer 1-4 timer for
// sent; Cloudflare kommer til tiden. Workeren beder derfor GitHub om at starte
// nightly-dispatcher.yml (slot "nat"), som venter på scraperne og selv starter
// cache-updateren bagefter (siden er opdateret ca. 45 min efter start).
//
// SÅ TIDLIGT SOM MULIGT, MEN MED DE RIGTIGE PRISER (Kalle, 24-10-2026):
// - D1 må kun genopbygges én gang pr. UTC-døgn (skrivebudgettet), og en kørsel
//   kort efter dansk midnat ville bruge det forrige UTC-døgns budget. Dagens
//   kørsel starter derfor tidligst 00:05 UTC (01:05 dansk vintertid, 02:05
//   sommertid).
// - Søndag til torsdag skifter de målte butikker ikke uge, og hentningen
//   starter med det samme.
// - Fredag (Bilka, Føtex, Meny, Spar, Min Købmand) og lørdag (Netto) lægger
//   butikkerne ugens nye tilbud ud på et tidspunkt, der skifter: Nettos avis
//   var ude før kl. 06 lørdag 18-10, men først efter 06:02 lørdag 24-10-2026,
//   og fredag 23-10 havde fem butikker stadig sidste uges priser kl. 00:01.
//   Workeren starter derfor .github/workflows/butikker-klar.yml hvert 15.
//   minut; den kigger i butikkernes egne data og starter selv hentningen,
//   når den nye uge er ude. Kl. 09:00 starter workeren den under alle
//   omstændigheder.
//
// Startes af 5-minutters-cron'en, ikke af en egen cron: en egen cron "1 0 * * *"
// blev aldrig kørt af Cloudflare natten til 13-10-2026. KV-nøglen MORNING_KEY
// husker den danske dato, så det sker én gang pr. døgn. En dublet der slipper
// igennem, stoppes af nightly-dispatcher (concurrency + højst én
// cache-updater pr. UTC-døgn).
const MORNING_KEY = "nat_morgen_v1";
const CHECK_KEY = "nat_klartjek_v1";
const CHECK_EVERY_MS = 15 * 60 * 1000;
const GATED_DAYS = new Set(["Fri", "Sat"]);
const DEADLINE_HOUR = 9;
const GH_API = "https://api.github.com/repos/Madshopper/Million/actions/workflows";
const DISPATCH_URL = `${GH_API}/nightly-dispatcher.yml/dispatches`;
const KLAR_URL = `${GH_API}/butikker-klar.yml/dispatches`;

function danishParts(ms) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t).value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")),
           minute: Number(get("minute")), weekday: get("weekday") };
}

function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "MadShopper-Uptime",
    "Content-Type": "application/json",
  };
}

// Har klar-tjekket allerede startet hentningen i dette UTC-døgn? Meny hentes
// hver morgen, så en Meny-kørsel i dag betyder, at den er i gang.
async function startedToday(env, utcDate) {
  const res = await fetch(`${GH_API}/scraper-Meny.yml/runs?per_page=1&created=%3E%3D${utcDate}`,
                          { headers: ghHeaders(env) });
  if (!res.ok) throw new Error(`GitHub svarede ${res.status} på kørselslisten`);
  return ((await res.json()).total_count || 0) > 0;
}

export async function startMorning(env, scheduledTime = Date.now()) {
  if (!env.GH_DISPATCH_TOKEN) return null;
  const dk = danishParts(scheduledTime);
  const utc = new Date(scheduledTime);
  const utcDate = utc.toISOString().slice(0, 10);
  if (utcDate !== dk.date || (utc.getUTCHours() === 0 && utc.getUTCMinutes() < 5)) return null;
  if (dk.hour >= 12) return null;  // kun om morgenen; kl. 09 er den altid startet
  if ((await env.STATE.get(MORNING_KEY)) === dk.date) return null;

  if (GATED_DAYS.has(dk.weekday)) {
    if (await startedToday(env, utcDate)) {
      await env.STATE.put(MORNING_KEY, dk.date);
      return "startet af klar-tjekket";
    }
    if (dk.hour < DEADLINE_HOUR) {
      const last = Number((await env.STATE.get(CHECK_KEY)) || 0);
      if (scheduledTime - last < CHECK_EVERY_MS - 60 * 1000) return null;
      await env.STATE.put(CHECK_KEY, String(scheduledTime));
      await dispatch(env, KLAR_URL, {});
      return "klar-tjek startet";
    }
  }
  // Datoen skrives før kaldet, så en dublet af samme tick ikke også starter.
  // Fejler kaldet, slettes den igen, og næste tick prøver.
  await env.STATE.put(MORNING_KEY, dk.date);
  try {
    await dispatch(env, DISPATCH_URL, { slot: "nat" });
    return "startet (nat)";
  } catch (err) {
    await env.STATE.delete(MORNING_KEY);
    throw err;
  }
}

async function dispatch(env, url, inputs) {
  const res = await fetch(url, {
    method: "POST",
    headers: ghHeaders(env),
    body: JSON.stringify({ ref: "main", inputs }),
  });
  if (res.status !== 204) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`GitHub svarede ${res.status}: ${text}`);
  }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(startMorning(env, event.scheduledTime).then(
      (r) => r && console.log("morgen:", r),
      (err) => console.error("morgen: kunne ikke starte nightly-dispatcher:", String(err)),
    ));
    ctx.waitUntil(check(env, event.scheduledTime).then((r) => {
      const failing = Object.keys(r.down);
      if (failing.length) console.error("uptime: nede:", JSON.stringify(r.results));
    }));
  },
};

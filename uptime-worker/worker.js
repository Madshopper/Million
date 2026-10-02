// MadShopper uptime-tjek: en lille, selvstændig JS-worker med en cron trigger
// hvert 5. minut (gratis plan). Erstatter browsertjekkene i uptime-check.yml,
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
// /api/stores) plus staging-login-siden, så hvert tjek koster et cache-hit,
// ikke en render. Den friske søgning er undtagelsen og kører kun én gang i
// døgnet (se SEARCH_CHECK): en ucachet søgning er en D1-tabelscanning på ~19k
// rows_read, og 288 af dem i døgnet sprænger gratisplanens 5M. Ventetid på
// svar tæller ikke mod CPU-grænsen på 10 ms.
//
// Alarm: én mail via Resend (samme konto og afsender som prisalarmerne) når et
// tjek går fra OK til fejl, og én når det er OK igen. Tilstanden ligger i KV
// og skrives KUN ved et skift, så normal drift koster 0 KV-skrivninger
// (kontoens gratis loft er 1.000 i døgnet, delt med nattens seed).

const STATE_KEY = "uptime_state_v1";
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
    // Staging er spærret bag login. Login-siden er den eneste sti der svarer
    // 200 uden adgang, og et GET dér logger ingen sikkerhedshændelse (det gør
    // alle andre stier, se _staging_blocked i src/worker.py).
    name: "Staging (dev.madshopper.dk)",
    url: "https://dev.madshopper.dk/staging-login",
    expect: (body) => body.includes("MadShopper staging"),
  },
];

// Frisk søgning: den eneste der går gennem render-vejen og D1 (de andre er
// cache-hits), og dermed den der fangede søgefejlen i september. Den unikke
// max_price gør url'en ny hver gang, så den aldrig rammer edge-cachen. Den
// koster en D1-tabelscanning (~19k rows_read), så den kører kun én gang i
// døgnet, og én gang i timen mens den er nede, aldrig hvert 5. minut.
const SEARCH_CHECK = {
  name: "Frisk søgning (mælk)",
  url: "https://madshopper.dk/search/results?q=m%C3%A6lk",
  fresh: true,
  expect: (body) => body.includes("MadShopper") && productCards(body, false),
};
const SEARCH_HOUR_UTC = 5;
const SEARCH_MINUTE = 40;

// Sitet lukkes bag login (src/worker.py); uloggede requests får kun en
// login-side. Workeren kommer forbi med X-MadShopper-Monitor, som hovedworkeren
// sammenligner konstant-tid med sit eget MONITOR_ACCESS_SECRET. Sendes kun til
// madshopper.dk-domænerne, aldrig til Resend.
let monitorSecret = "";

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
    if (monitorSecret) headers["X-MadShopper-Monitor"] = monitorSecret;
    const resp = await fetch(url, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - started;
    const body = await resp.text();
    if (resp.status !== 200) {
      const busy = resp.headers.get("X-MadShopper-Busy") ? " (travlt)" : "";
      return { ok: false, detail: `HTTP ${resp.status}${busy} efter ${ms} ms` };
    }
    if (resp.headers.get("X-Data-Degraded")) {
      return { ok: false, detail: `200 men degraderet (X-Data-Degraded) efter ${ms} ms` };
    }
    const verdict = check.expect(body);
    if (verdict !== true) {
      const why = typeof verdict === "string" ? verdict : "forventet indhold mangler";
      return { ok: false, detail: `200 men ${why} (${body.length} bytes) efter ${ms} ms` };
    }
    return { ok: true, detail: `200 på ${ms} ms` };
  } catch (err) {
    const ms = Date.now() - started;
    const what = err && err.name === "TimeoutError" ? `timeout efter ${TIMEOUT_MS} ms` : String(err);
    return { ok: false, detail: `${what} (${ms} ms)` };
  }
}

async function runAll(checks) {
  const results = new Map();
  await Promise.all(checks.map(async (c) => results.set(c.name, await runCheck(c))));
  const failing = checks.filter((c) => !results.get(c.name).ok);
  if (failing.length) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    await Promise.all(failing.map(async (c) => {
      const first = results.get(c.name);
      const again = await runCheck(c);
      results.set(c.name, again.ok ? again : { ok: false, detail: `${first.detail}; igen: ${again.detail}` });
    }));
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
  monitorSecret = env.MONITOR_ACCESS_SECRET || "";
  let state = null;
  let firstRun = false;
  try {
    state = await env.STATE.get(STATE_KEY, "json");
    firstRun = state === null;
  } catch (err) {
    console.error("uptime: KV-læsning fejlede:", String(err));
  }
  const prevDown = (state && state.down) || {};

  const when = new Date(scheduledTime);
  const searchSlot = when.getUTCMinutes() === SEARCH_MINUTE;
  const runSearch = searchSlot && (when.getUTCHours() === SEARCH_HOUR_UTC || !!prevDown[SEARCH_CHECK.name]);
  const checks = runSearch ? [...CHECKS, SEARCH_CHECK] : CHECKS;
  const allChecks = [...CHECKS, SEARCH_CHECK];

  const results = await runAll(checks);
  const now = new Date().toISOString();

  // Et tjek der ikke kørte denne gang (søgningen), beholder sin tilstand.
  const down = {};
  for (const [name, since] of Object.entries(prevDown)) {
    if (!checks.some((c) => c.name === name) && allChecks.some((c) => c.name === name)) down[name] = since;
  }
  const newlyDown = [];
  for (const c of checks) {
    if (results.get(c.name).ok) continue;
    down[c.name] = prevDown[c.name] || now;
    if (!prevDown[c.name]) newlyDown.push(c);
  }
  const recovered = Object.keys(prevDown).filter((name) => !down[name]);

  // Første kørsel efter deploy: én kvitteringsmail, så det er bevist at hele
  // vejen til indbakken virker, før der er brug for den.
  if (firstRun && !newlyDown.length) {
    const lines = checks.map((c) => `${c.name}: ${results.get(c.name).detail}`);
    if (await sendMail(env, "MadShopper uptime-overvågning er aktiv", lines)) {
      await env.STATE.put(STATE_KEY, JSON.stringify({ down, changed_at: now }));
    }
  } else if (newlyDown.length || recovered.length) {
    const lines = [];
    for (const c of newlyDown) lines.push(`NEDE: ${c.name} (${c.url}): ${results.get(c.name).detail}`);
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
      await env.STATE.put(STATE_KEY, JSON.stringify({ down, changed_at: now }));
    }
  }
  return { results: Object.fromEntries(results), down, newlyDown: newlyDown.map((c) => c.name), recovered };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(check(env, event.scheduledTime).then((r) => {
      const failing = Object.keys(r.down);
      if (failing.length) console.error("uptime: nede:", JSON.stringify(r.results));
    }));
  },
};

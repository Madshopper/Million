// Privat site (src/worker.py::_site_gate): overvågning og opvarmning kommer
// forbi login med en afledt nøgle i cookien ms_monitor - HMAC af
// CACHE_REFRESH_SECRET, samme afledning som site_gate.py::monitor_token. Den rå
// hemmelighed forlader aldrig CI. Cookien sættes kun for sitets eget domæne,
// så den aldrig sendes til Supabase, Google eller andre tredjeparter.
import { createHmac } from "node:crypto";

export async function addMonitorAccess(context, siteUrl) {
  const secret = (process.env.MONITOR_SECRET || "").trim();
  if (!secret) {
    console.log("advarsel: MONITOR_SECRET ikke sat - siden svarer med login-siden");
    return;
  }
  const value = createHmac("sha256", secret).update("monitor-access").digest("hex");
  const { protocol, hostname } = new URL(siteUrl);
  await context.addCookies([{
    name: "ms_monitor", value, domain: hostname, path: "/",
    secure: protocol === "https:", httpOnly: true, sameSite: "Lax",
  }]);
}

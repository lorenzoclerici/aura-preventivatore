"use strict";
/*
  Utilità condivise dalle funzioni /api (il prefisso "_" evita che Vercel le esponga come indirizzo).
  - sessione: cookie firmato (HMAC) dopo la password unica
  - dati: Upstash Redis tramite REST, senza librerie da installare
*/

const STATI = ["Generato", "Inviato", "Accettato", "Rifiutato"];
const CAMPI = ["numero", "data", "validita", "consulente", "cliente", "indirizzo", "cf", "piva", "tel", "email",
  "marca", "versione", "immat", "km", "alim", "cambio", "colore", "prezzo", "anticipo", "canone", "durata",
  "kmInc", "kmUnit", "servInc", "servEsc", "noteEco", "note"];
const K = {
  idx: "aura:q:idx",                 // hash  id -> riepilogo (JSON)
  nums: "aura:q:nums",               // hash  numero -> id (garantisce numeri unici)
  q: id => `aura:q:d:${id}`,         // dati completi del preventivo (JSON, senza foto)
  f: id => `aura:q:f:${id}`,         // foto (data URL)
  n: anno => `aura:q:n:${anno}`,     // ultimo numero assegnato nell'anno
};
const COOKIE = "aura_sid";
const SESSIONE_GIORNI = 30;

const wc = (globalThis.crypto && globalThis.crypto.subtle) ? globalThis.crypto : require("node:crypto").webcrypto;
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");

async function hmac(chiave, msg) {
  const k = await wc.subtle.importKey("raw", enc.encode(chiave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await wc.subtle.sign("HMAC", k, enc.encode(msg)));
}
// confronto a tempo costante tra due stringhe esadecimali
function uguali(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const errore = (status, msg) => Object.assign(new Error(msg), { status });
const segreto = () => process.env.SESSION_SECRET || ("aura|" + (process.env.APP_PASSWORD || ""));

async function creaToken() {
  const scade = Date.now() + SESSIONE_GIORNI * 864e5;
  return scade + "." + await hmac(segreto(), "sessione|" + scade);
}
async function tokenValido(t) {
  const [scade, firma] = String(t || "").split(".");
  if (!scade || !firma || !(+scade > Date.now())) return false;
  return uguali(firma, await hmac(segreto(), "sessione|" + scade));
}
function leggiCookie(req, nome) {
  const c = String(req.headers.cookie || "").split(/;\s*/).find(x => x.startsWith(nome + "="));
  return c ? decodeURIComponent(c.slice(nome.length + 1)) : "";
}
function scriviSessione(req, res, token, maxAge) {
  const sicuro = String(req.headers["x-forwarded-proto"] || "").includes("https") ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${sicuro}`);
}

function configRedis() {
  const e = process.env;
  const url = e.KV_REST_API_URL || e.UPSTASH_REDIS_REST_URL;
  const token = e.KV_REST_API_TOKEN || e.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}
// esegue più comandi Redis in un colpo solo e restituisce i risultati in ordine
async function redis(comandi) {
  const c = configRedis();
  if (!c) throw errore(503, "storage_non_configurato");
  let r;
  try {
    r = await fetch(c.url + "/pipeline", {
      method: "POST",
      headers: { Authorization: "Bearer " + c.token, "Content-Type": "application/json" },
      body: JSON.stringify(comandi),
    });
  } catch (e) { throw errore(502, "storage_non_raggiungibile"); }
  if (!r.ok) throw errore(502, "storage_errore");
  const out = await r.json();
  return out.map(o => { if (o.error) throw errore(502, "storage_errore"); return o.result; });
}
const cmd = async (...a) => (await redis([a]))[0];

function corpo(req) {
  const b = req.body;
  if (typeof b === "string") { try { return JSON.parse(b || "{}"); } catch (e) { throw errore(400, "json_non_valido"); } }
  return b && typeof b === "object" ? b : {};
}

// avvolge una funzione: password configurata, difesa CSRF, controllo sessione, gestione errori
function proteggi(fn, { auth = true } = {}) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (!process.env.APP_PASSWORD) throw errore(500, "password_non_configurata");
      if (req.method !== "GET" && req.headers["x-aura"] !== "1") throw errore(403, "richiesta_non_valida");
      if (auth && !(await tokenValido(leggiCookie(req, COOKIE)))) throw errore(401, "non_autenticato");
      const out = await fn(req, res);
      if (out !== undefined) res.status(200).json(out);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.status ? e.message : "errore_interno" });
    }
  };
}

module.exports = {
  STATI, CAMPI, K, SESSIONE_GIORNI,
  hmac, uguali, errore, creaToken, tokenValido, leggiCookie, scriviSessione,
  configRedis, redis, cmd, corpo, proteggi,
};

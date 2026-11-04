"use strict";
/*
  /api/session
    GET     → 200 se la sessione è valida, 401 altrimenti
    POST    → { password } controlla la password unica e apre la sessione (cookie)
    DELETE  → chiude la sessione
*/
const c = require("./_core.js");

module.exports = c.proteggi(async (req, res) => {
  const storage = !!c.configRedis();

  if (req.method === "GET") {
    if (!(await c.tokenValido(c.leggiCookie(req, "aura_sid")))) throw c.errore(401, "non_autenticato");
    return { ok: true, storage };
  }

  if (req.method === "DELETE") {
    c.scriviSessione(req, res, "", 0);
    return { ok: true };
  }

  if (req.method === "POST") {
    // massimo 10 tentativi ogni 15 minuti per indirizzo IP (se il database non risponde, si prosegue)
    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "sconosciuto";
    const chiave = "aura:q:rl:" + ip;
    if (storage) {
      try {
        const n = (await c.redis([["INCR", chiave], ["EXPIRE", chiave, 900]]))[0];
        if (n > 10) throw c.errore(429, "troppi_tentativi");
      } catch (e) { if (e.status === 429) throw e; }
    }
    const pw = String(c.corpo(req).password || "");
    const giusta = c.uguali(await c.hmac("password", pw), await c.hmac("password", process.env.APP_PASSWORD));
    if (!giusta) throw c.errore(401, "password_errata");
    if (storage) { try { await c.cmd("DEL", chiave); } catch (e) {} }
    c.scriviSessione(req, res, await c.creaToken(), c.SESSIONE_GIORNI * 86400);
    return { ok: true, storage };
  }

  throw c.errore(405, "metodo_non_consentito");
}, { auth: false });

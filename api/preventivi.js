"use strict";
/*
  /api/preventivi  (tutte le richieste richiedono la sessione)
    GET                  → elenco dei riepiloghi, dal più recente
    GET ?next=1&anno=AAAA→ prossimo numero suggerito
    GET ?id=…            → preventivo completo (dati + foto)
    POST                 → { id, data, foto } salva o aggiorna; assegna un numero unico
    PATCH  ?id=…         → { stato } cambia lo stato
    DELETE ?id=…         → elimina
*/
const c = require("./_core.js");
const { K, STATI, CAMPI, errore, redis, cmd } = c;

const RE_ID = /^[A-Za-z0-9-]{8,64}$/;
const RE_NUMERO = /^\d{4}-\d{3,}$/;
const RE_FOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const FOTO_MAX = 900000;                       // caratteri del data URL

const idValido = id => { if (!RE_ID.test(id)) throw errore(400, "id_non_valido"); return id; };
const formatta = (anno, n) => `${anno}-${String(n).padStart(3, "0")}`;
const annoDi = s => /^\d{4}/.test(String(s || "")) ? String(s).slice(0, 4) : String(new Date().getFullYear());
const parse = s => { try { return JSON.parse(s); } catch (e) { return null; } };

// tiene solo i campi del modulo, come testo e con una lunghezza massima
function pulisci(d) {
  const o = {};
  for (const k of CAMPI) o[k] = String(d && d[k] != null ? d[k] : "").slice(0, 5000);
  return o;
}

async function prossimoNumero(anno) {
  let n = +(await cmd("GET", K.n(anno)) || 0);
  for (let i = 0; i < 50; i++) {
    n++;
    const num = formatta(anno, n);
    if (!(await cmd("HEXISTS", K.nums, num))) return num;
  }
  throw errore(409, "numero_non_assegnabile");
}

async function salva(body) {
  const id = idValido(String(body.id || ""));
  const d = pulisci(body.data);
  let foto = "";
  if (body.foto) {
    foto = String(body.foto);
    if (!RE_FOTO.test(foto) || foto.length > FOTO_MAX) throw errore(400, "foto_non_valida");
  }

  const vecchio = parse(await cmd("HGET", K.idx, id));
  const anno = annoDi(d.data);
  const rivendica = async num => {
    if (await cmd("HSETNX", K.nums, num, id)) return true;
    return (await cmd("HGET", K.nums, num)) === id;          // già mio (nuovo salvataggio dello stesso preventivo)
  };

  // numero scelto a mano o suggerito: lo si tiene solo se libero, altrimenti ne assegna uno nuovo
  let numero = d.numero.trim();
  if (!(RE_NUMERO.test(numero) && await rivendica(numero))) {
    numero = "";
    for (let i = 0; i < 30 && !numero; i++) {
      const cand = formatta(anno, await cmd("INCR", K.n(anno)));
      if (await rivendica(cand)) numero = cand;
    }
    if (!numero) throw errore(409, "numero_non_assegnabile");
  }
  d.numero = numero;
  // il contatore dell'anno non deve restare indietro rispetto ai numeri già assegnati
  const mn = /^(\d{4})-(\d+)$/.exec(numero);
  if (mn && +mn[2] > +(await cmd("GET", K.n(mn[1])) || 0)) await cmd("SET", K.n(mn[1]), String(+mn[2]));
  if (vecchio && vecchio.numero !== numero && (await cmd("HGET", K.nums, vecchio.numero)) === id) {
    await cmd("HDEL", K.nums, vecchio.numero);
  }

  const ora = new Date().toISOString();
  const riepilogo = {
    id, numero, data: d.data.slice(0, 10),
    cliente: d.cliente.slice(0, 120), marca: d.marca.slice(0, 80), versione: d.versione.slice(0, 80),
    canone: d.canone.slice(0, 30), ivaBase: d.ivaBase === "escl" ? "escl" : "incl", consulente: d.consulente.slice(0, 80),
    stato: vecchio && STATI.includes(vecchio.stato) ? vecchio.stato : STATI[0],
    creato: vecchio ? vecchio.creato : ora, aggiornato: ora, foto: !!foto,
  };
  await redis([
    ["HSET", K.idx, id, JSON.stringify(riepilogo)],
    ["SET", K.q(id), JSON.stringify(d)],
    foto ? ["SET", K.f(id), foto] : ["DEL", K.f(id)],
  ]);
  return { numero, riepilogo };
}

module.exports = c.proteggi(async (req) => {
  const q = req.query || {};

  if (req.method === "GET") {
    if (q.next) return { numero: await prossimoNumero(annoDi(q.anno)) };
    if (q.id) {
      const id = idValido(String(q.id));
      const [r, dati, foto] = await redis([["HGET", K.idx, id], ["GET", K.q(id)], ["GET", K.f(id)]]);
      const riepilogo = parse(r), data = parse(dati);
      if (!riepilogo || !data) throw errore(404, "non_trovato");
      return { id, data, foto: foto || "", stato: riepilogo.stato };
    }
    const items = ((await cmd("HVALS", K.idx)) || []).map(parse).filter(Boolean)
      .sort((a, b) => String(b.creato).localeCompare(String(a.creato)));
    return { items };
  }

  if (req.method === "POST") return salva(c.corpo(req));

  if (req.method === "PATCH") {
    const id = idValido(String(q.id || ""));
    const stato = c.corpo(req).stato;
    if (!STATI.includes(stato)) throw errore(400, "stato_non_valido");
    const r = parse(await cmd("HGET", K.idx, id));
    if (!r) throw errore(404, "non_trovato");
    r.stato = stato; r.aggiornato = new Date().toISOString();
    await cmd("HSET", K.idx, id, JSON.stringify(r));
    return { ok: true, riepilogo: r };
  }

  if (req.method === "DELETE") {
    const id = idValido(String(q.id || ""));
    const r = parse(await cmd("HGET", K.idx, id));
    if (!r) return { ok: true };
    const comandi = [["HDEL", K.idx, id], ["DEL", K.q(id)], ["DEL", K.f(id)]];
    if ((await cmd("HGET", K.nums, r.numero)) === id) comandi.push(["HDEL", K.nums, r.numero]);
    await redis(comandi);
    return { ok: true };
  }

  throw errore(405, "metodo_non_consentito");
});

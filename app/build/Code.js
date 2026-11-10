// СГЕНЕРИРОВАНО (npm run build) — не редактировать.
"use strict";
var ZenApp = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key2 of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key2) && key2 !== except)
          __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/gas/main.ts
  var main_exports = {};
  __export(main_exports, {
    checkZen: () => checkZen,
    dumpSample: () => dumpSample,
    install: () => install,
    run: () => run,
    uninstall: () => uninstall
  });

  // src/core/html.ts
  var NAMED = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'"
  };
  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 1114111 ? String.fromCodePoint(code) : m;
      }
      return NAMED[e.toLowerCase()] ?? m;
    });
  }
  function normalizeText(s) {
    return s.normalize("NFC").replace(/[\s ​﻿]+/g, " ").trim();
  }
  var BLOCK = /<\/?(?:td|th|tr|table|tbody|thead|p|div|br|li|ul|ol|h[1-6]|hr)\b[^>]*>/gi;
  function htmlToCells(html) {
    const SEP = "";
    const text = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(style|script|head|title)\b[\s\S]*?<\/\1\s*>/gi, "").replace(BLOCK, SEP).replace(/<[^>]*>/g, "");
    return decodeEntities(text).split(SEP).map(normalizeText).filter((c) => c !== "");
  }

  // src/core/banks/vcb/transfer-receipt.ts
  var LABELS = {
    dateTime: ["Ngày, giờ giao dịch", "Trans. Date, Time"],
    orderNumber: ["Số lệnh giao dịch", "Order Number"],
    debitAccount: ["Tài khoản nguồn", "Debit Account"],
    remitter: ["Tên người chuyển tiền", "Remitter's name"],
    creditAccount: ["Tài khoản người hưởng", "Credit Account"],
    beneficiaryName: ["Tên người hưởng", "Beneficiary Name"],
    beneficiaryBank: ["Tên ngân hàng hưởng", "Beneficiary Bank Name"],
    amount: ["Số tiền", "Amount"],
    chargeCode: ["Loại phí", "Charge Code"],
    chargeAmount: ["Số tiền phí", "Charge Amount"],
    details: ["Nội dung chuyển tiền", "Details of Payment"]
  };
  var REQUIRED = ["dateTime", "orderNumber", "amount", "chargeAmount"];
  var key = (s) => normalizeText(s).toLowerCase().replace(/[’`]/g, "'");
  var LABEL_INDEX = /* @__PURE__ */ new Map();
  for (const f of Object.keys(LABELS)) for (const l of LABELS[f]) LABEL_INDEX.set(key(l), f);
  function asLabel(cell) {
    const colon = cell.indexOf(":");
    const head = colon >= 0 ? cell.slice(0, colon) : cell;
    const inline = colon >= 0 ? normalizeText(cell.slice(colon + 1)) : "";
    let field;
    for (const part of head.split("/")) {
      const f = LABEL_INDEX.get(key(part));
      if (f === void 0) return null;
      if (field !== void 0 && field !== f) return null;
      field = f;
    }
    return field === void 0 ? null : { field, inline };
  }
  function splitLabel(cell) {
    const lab = asLabel(cell);
    if (!lab) return null;
    const colon = cell.indexOf(":");
    return { head: colon >= 0 ? cell.slice(0, colon) : cell, inline: lab.inline };
  }
  function extractFieldRuns(cells) {
    const out = {};
    for (let i = 0; i < cells.length; i++) {
      const lab = asLabel(cells[i]);
      if (!lab || out[lab.field] !== void 0) continue;
      const run2 = lab.inline ? [lab.inline] : [];
      for (let j = i + 1; j < cells.length; j++) {
        const next = asLabel(cells[j]);
        if (!next) {
          run2.push(cells[j]);
          continue;
        }
        if (next.field !== lab.field) break;
        if (next.inline) run2.push(next.inline);
      }
      out[lab.field] = run2;
    }
    return out;
  }
  function extractFields(cells) {
    const out = {};
    const runs = extractFieldRuns(cells);
    for (const f of Object.keys(runs)) if (runs[f].length) out[f] = runs[f][0];
    return out;
  }
  function parseVcbFee(run2) {
    const amounts = run2.map(parseVcbAmount).filter((a) => a !== null);
    if (!amounts.length) return { error: "не разобрана комиссия" };
    if (amounts.length > 1 && amounts.some((a) => a.amount > 0)) {
      return { error: "ненулевая комиссия с разбивкой (VAT): нужен образец письма" };
    }
    return amounts[0];
  }
  function parseVcbDateTime(s) {
    const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\D+?(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
    if (!m) return null;
    const [hh, mi, ss, dd, mo, yyyy] = [m[1], m[2], m[3] ?? "00", m[4], m[5], m[6]].map(Number);
    if (hh > 23 || mi > 59 || ss > 59 || mo < 1 || mo > 12 || dd < 1) return null;
    if (dd > new Date(Date.UTC(yyyy, mo, 0)).getUTCDate()) return null;
    const p = (n) => String(n).padStart(2, "0");
    const dateLocal = `${yyyy}-${p(mo)}-${p(dd)}`;
    return { occurredAtLocal: `${dateLocal}T${p(hh)}:${p(mi)}:${p(ss)}+07:00`, dateLocal };
  }
  function parseVcbAmount(s) {
    const m = /^(\d{1,3}(?:,\d{3})*|\d+)(\.\d+)?\s*([A-Za-z]{3})$/.exec(normalizeText(s));
    if (!m) return null;
    const amount = Number(m[1].replace(/,/g, "") + (m[2] ?? ""));
    return Number.isFinite(amount) ? { amount, currency: m[3].toUpperCase() } : null;
  }
  var digits = (s) => {
    const d = s?.replace(/[\s.-]/g, "");
    return d && /^\d+$/.test(d) ? d : void 0;
  };
  function classify(debit, credit, own) {
    const d = debit !== void 0 && own.includes(debit);
    const c = credit !== void 0 && own.includes(credit);
    return d && c ? "transfer" : d ? "expense" : c ? "income" : "unknown";
  }
  function parseTransferReceiptCells(cells, ctx) {
    const runs = extractFieldRuns(cells);
    const f = extractFields(cells);
    const missing = REQUIRED.filter((k) => !f[k]);
    if (missing.length) return { ok: false, error: `нет полей: ${missing.join(", ")}` };
    const dt = parseVcbDateTime(f.dateTime);
    if (!dt) return { ok: false, error: "не разобрана дата" };
    const amount = parseVcbAmount(f.amount);
    if (!amount || amount.amount <= 0) return { ok: false, error: "не разобрана сумма" };
    const fee = parseVcbFee(runs.chargeAmount ?? []);
    if ("error" in fee) return { ok: false, error: fee.error };
    if (fee.amount > 0 && fee.currency !== amount.currency) return { ok: false, error: "валюта комиссии отличается" };
    const orderNumber = f.orderNumber.replace(/\s/g, "");
    if (!/^[A-Za-z0-9-]+$/.test(orderNumber)) return { ok: false, error: "не разобран Order Number" };
    const debitAccount = digits(f.debitAccount);
    const creditAccount = digits(f.creditAccount);
    return {
      ok: true,
      txn: {
        source: "vcb-email",
        emailType: "transfer_receipt",
        gmailMessageId: ctx.gmailMessageId,
        orderNumber,
        ...dt,
        amount: amount.amount,
        currency: amount.currency,
        feeAmount: fee.amount,
        debitAccount,
        creditAccount,
        remitter: f.remitter,
        beneficiaryName: f.beneficiaryName,
        beneficiaryBank: f.beneficiaryBank,
        details: f.details,
        kind: classify(debitAccount, creditAccount, ctx.ownAccounts),
        auth: ctx.auth
      }
    };
  }
  function parseTransferReceipt(html, ctx) {
    return parseTransferReceiptCells(htmlToCells(html), ctx);
  }

  // src/core/banks/vcb/anonymize.ts
  var maskAll = (s) => s.replace(/\p{L}/gu, "x").replace(/\d/g, "0");
  var maskDigits = (s) => s.replace(/[\w.+-]+@[\w.-]+/g, "x@x.x").replace(/\d/g, "0");
  function anonymizeHtml(html) {
    let afterLabel = false;
    let skip = false;
    return html.split(/(<[^>]*>)/).map((part) => {
      if (part.startsWith("<")) {
        if (/^<(style|script)\b/i.test(part)) skip = true;
        if (/^<\/(style|script)/i.test(part)) skip = false;
        return part.replace(/\b(href|src|alt|title)\s*=\s*("[^"]*"|'[^']*')/gi, '$1="#"');
      }
      if (skip) return part;
      const text = normalizeText(decodeEntities(part));
      if (!text) return part;
      const lab = splitLabel(text);
      if (lab) {
        afterLabel = !lab.inline;
        return lab.inline ? `${lab.head}: ${maskAll(lab.inline)}` : part;
      }
      if (afterLabel) {
        afterLabel = false;
        return maskAll(text);
      }
      return maskDigits(text);
    }).join("");
  }

  // src/core/auth.ts
  var TRUSTED_AUTHSERV = "mx.google.com";
  function topAuthResultsHeader(raw) {
    const end = raw.search(/\r?\n\r?\n/);
    const head = (end >= 0 ? raw.slice(0, end) : raw).replace(/\r?\n[ \t]+/g, " ");
    for (const line of head.split(/\r?\n/)) {
      const m = /^Authentication-Results:\s*(.*)$/i.exec(line);
      if (m) return m[1];
    }
    return null;
  }
  var domainOf = (v) => v.toLowerCase().replace(/^.*@/, "").replace(/[">]+$/, "");
  var aligned = (domain, org) => domain === org || domain.endsWith("." + org);
  function parseAuthResults(value, orgDomain) {
    const res = { dkim: false, spf: false, dmarc: false };
    if (!value) return res;
    const parts = value.replace(/\([^)]*\)/g, " ").split(";").map((p) => p.trim());
    if (parts[0]?.split(/\s+/)[0]?.toLowerCase() !== TRUSTED_AUTHSERV) return res;
    for (const part of parts.slice(1)) {
      const m = /^(dkim|spf|dmarc)=(\w+)\b(.*)$/i.exec(part);
      if (!m || m[2].toLowerCase() !== "pass") continue;
      const props = /* @__PURE__ */ new Map();
      for (const kv of m[3].matchAll(/([\w.]+)=(\S+)/g)) props.set(kv[1].toLowerCase(), kv[2]);
      const method = m[1].toLowerCase();
      const keys = method === "dkim" ? ["header.i", "header.d"] : method === "spf" ? ["smtp.mailfrom"] : ["header.from"];
      if (keys.some((k) => props.has(k) && aligned(domainOf(props.get(k)), orgDomain))) res[method] = true;
    }
    return res;
  }
  var isTrusted = (a) => a.dkim && a.dmarc;

  // src/core/pipeline.ts
  var VCB_SENDER = "vcbdigibank@info.vietcombank.com.vn";
  var VCB_ORG_DOMAIN = "vietcombank.com.vn";
  var address = (from) => (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
  function processEmail(msg, ownAccounts) {
    const auth = parseAuthResults(topAuthResultsHeader(msg.raw), VCB_ORG_DOMAIN);
    if (address(msg.from) !== VCB_SENDER) return { status: "quarantine", reason: "чужой отправитель", auth };
    if (!isTrusted(auth)) return { status: "quarantine", reason: "не прошла проверка DKIM/DMARC", auth };
    const r = parseTransferReceipt(msg.html, { gmailMessageId: msg.id, auth, ownAccounts });
    return r.ok ? { status: "parsed", txn: r.txn } : { status: "unparsed", reason: r.error, auth };
  }
  var maskAccount = (a) => a ? "****" + a.slice(-4) : "-";
  var authStr = (a) => ["dkim", "spf", "dmarc"].map((k) => `${k}=${a[k] ? "pass" : "no"}`).join(" ");
  function formatLog(id, o) {
    if (o.status !== "parsed") return `${o.status} msg=${id} причина: ${o.reason} (${authStr(o.auth)})`;
    const t = o.txn;
    return `parsed msg=${id} order=${t.orderNumber} ${t.occurredAtLocal} ${t.amount} ${t.currency} fee=${t.feeAmount} kind=${t.kind} debit=${maskAccount(t.debitAccount)} credit=${maskAccount(t.creditAccount)} (${authStr(t.auth)})`;
  }

  // src/core/zen/diff.ts
  var ZEN_DIFF_URL = "https://api.zenmoney.ru/v8/diff/";
  var fullFetchRequest = (now) => ({ currentClientTimestamp: now, serverTimestamp: 0 });
  function readMeta(resp) {
    const d = resp;
    const parents = (d.user ?? []).filter((u) => u.parent === null);
    if (parents.length !== 1) throw new Error(`ожидался один родительский пользователь, найдено ${parents.length}`);
    if (typeof d.serverTimestamp !== "number") throw new Error("в ответе нет serverTimestamp");
    const instruments = {};
    for (const i of d.instrument ?? []) if (instruments[i.shortTitle] === void 0) instruments[i.shortTitle] = i.id;
    return {
      serverTimestamp: d.serverTimestamp,
      userId: parents[0].id,
      instruments,
      accountIds: new Set((d.account ?? []).filter((a) => !a.archive).map((a) => a.id))
    };
  }
  var readTransactions = (resp) => resp.transaction ?? [];
  function writeRequest(serverTimestamp, txns, now) {
    return { currentClientTimestamp: now, serverTimestamp, transaction: txns };
  }
  function missingAfterWrite(resp, ids) {
    const got = new Set(readTransactions(resp).map((t) => t.id));
    return ids.filter((id) => !got.has(id));
  }

  // src/core/zen/dedup.ts
  var DAY = 864e5;
  var dayDiff = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;
  function sameSide(c, e) {
    if (c.outcome > 0 && e.outcomeAccount === c.outcomeAccount && e.outcome === c.outcome) return true;
    if (c.income > 0 && e.incomeAccount === c.incomeAccount && e.income === c.income) return true;
    return false;
  }
  function planWrites(candidates, existing) {
    const byId = new Map(existing.map((e) => [e.id, e]));
    const manual = existing.filter((e) => !e.deleted && !(e.comment ?? "").includes("[vcb:"));
    const used = /* @__PURE__ */ new Set();
    return candidates.map((txn) => {
      const e = byId.get(txn.id);
      if (e) return { action: e.deleted ? "deleted" : "exists", txn };
      const match = manual.find((m) => !used.has(m.id) && dayDiff(m.date, txn.date) <= 1 && sameSide(txn, m));
      if (match) {
        used.add(match.id);
        return { action: "manual-duplicate", txn, match };
      }
      return { action: "create", txn };
    });
  }

  // src/core/uuid.ts
  function sha1(bytes) {
    const len = bytes.length;
    const padded = new Uint8Array((len + 8 >> 6) + 1 << 6);
    padded.set(bytes);
    padded[len] = 128;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, Math.floor(len * 8 / 4294967296));
    dv.setUint32(padded.length - 4, len * 8 >>> 0);
    const h = [1732584193, 4023233417, 2562383102, 271733878, 3285377520];
    const w = new Uint32Array(80);
    const rol = (x, n) => x << n | x >>> 32 - n;
    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
      let [a, b, c, d, e] = h;
      for (let i = 0; i < 80; i++) {
        const [f, k] = i < 20 ? [b & c | ~b & d, 1518500249] : i < 40 ? [b ^ c ^ d, 1859775393] : i < 60 ? [b & c | b & d | c & d, 2400959708] : [b ^ c ^ d, 3395469782];
        const t = rol(a, 5) + f + e + k + w[i] | 0;
        e = d;
        d = c;
        c = rol(b, 30);
        b = a;
        a = t;
      }
      h[0] = h[0] + a | 0;
      h[1] = h[1] + b | 0;
      h[2] = h[2] + c | 0;
      h[3] = h[3] + d | 0;
      h[4] = h[4] + e | 0;
    }
    const out = new Uint8Array(20);
    const odv = new DataView(out.buffer);
    h.forEach((v, i) => odv.setUint32(i * 4, v >>> 0));
    return out;
  }
  function utf8(s) {
    const out = [];
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (c < 128) out.push(c);
      else if (c < 2048) out.push(192 | c >> 6, 128 | c & 63);
      else if (c < 65536) out.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
      else out.push(240 | c >> 18, 128 | c >> 12 & 63, 128 | c >> 6 & 63, 128 | c & 63);
    }
    return Uint8Array.from(out);
  }
  var NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
  function uuidv5(name, namespace = NAMESPACE) {
    const ns = Uint8Array.from(namespace.replace(/-/g, "").match(/../g).map((b) => parseInt(b, 16)));
    const nameBytes = utf8(name);
    const buf = new Uint8Array(16 + nameBytes.length);
    buf.set(ns);
    buf.set(nameBytes, 16);
    const hash = sha1(buf).slice(0, 16);
    hash[6] = hash[6] & 15 | 80;
    hash[8] = hash[8] & 63 | 128;
    const hex = Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  var vcbTxnId = (orderNumber, fee = false) => uuidv5(`vcb:${orderNumber}${fee ? ":fee" : ""}`);

  // src/core/zen/mapper.ts
  var marker = (orderNumber, fee = false) => `[vcb:${orderNumber}${fee ? ":fee" : ""}]`;
  function blank(ctx) {
    return {
      changed: ctx.now,
      created: ctx.now,
      user: ctx.userId,
      deleted: false,
      hold: null,
      tag: null,
      merchant: null,
      payee: null,
      originalPayee: null,
      comment: null,
      reminderMarker: null,
      opIncome: null,
      opIncomeInstrument: null,
      opOutcome: null,
      opOutcomeInstrument: null,
      latitude: null,
      longitude: null,
      incomeBankID: null,
      outcomeBankID: null,
      qrCode: null,
      source: null,
      viewed: false
      // новая операция подсвечивается в приложении как непросмотренная
    };
  }
  var withMarker = (text, m) => text ? `${text} ${m}` : m;
  var norm = (s) => s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  function cleanDetails(details, remitter) {
    if (!details) return void 0;
    if (remitter && norm(details) === `${norm(remitter)} transfer`) return void 0;
    return details;
  }
  function toZenTransactions(t, ctx) {
    const instrument = ctx.instruments[t.currency];
    if (instrument === void 0) return { ok: false, reason: `нет валюты ${t.currency} в Дзен-мани` };
    const debit = t.debitAccount ? ctx.accounts[t.debitAccount] : void 0;
    const credit = t.creditAccount ? ctx.accounts[t.creditAccount] : void 0;
    let outcomeAccount;
    let incomeAccount;
    let outcome = 0;
    let income = 0;
    let payee = null;
    switch (t.kind) {
      case "expense":
        if (!debit) return { ok: false, reason: "счёт списания не найден в ACCOUNTS" };
        outcomeAccount = incomeAccount = debit;
        outcome = t.amount;
        payee = t.beneficiaryName ?? null;
        break;
      case "income":
        if (!credit) return { ok: false, reason: "счёт зачисления не найден в ACCOUNTS" };
        outcomeAccount = incomeAccount = credit;
        income = t.amount;
        payee = t.remitter ?? null;
        break;
      case "transfer":
        if (!debit || !credit) return { ok: false, reason: "счета перевода не найдены в ACCOUNTS" };
        outcomeAccount = debit;
        incomeAccount = credit;
        outcome = income = t.amount;
        break;
      default:
        return { ok: false, reason: "ни один счёт из письма не указан в ACCOUNTS" };
    }
    const main = {
      ...blank(ctx),
      id: vcbTxnId(t.orderNumber),
      incomeInstrument: instrument,
      incomeAccount,
      income,
      outcomeInstrument: instrument,
      outcomeAccount,
      outcome,
      payee,
      originalPayee: payee,
      comment: withMarker(cleanDetails(t.details, t.remitter), marker(t.orderNumber)),
      date: t.dateLocal
    };
    const txns = [main];
    if (t.feeAmount > 0) {
      if (!debit) return { ok: false, reason: "комиссия, но счёт списания не найден в ACCOUNTS" };
      txns.push({
        ...blank(ctx),
        id: vcbTxnId(t.orderNumber, true),
        incomeInstrument: instrument,
        incomeAccount: debit,
        income: 0,
        outcomeInstrument: instrument,
        outcomeAccount: debit,
        outcome: t.feeAmount,
        payee: "Vietcombank",
        originalPayee: null,
        comment: withMarker("Комиссия за перевод", marker(t.orderNumber, true)),
        date: t.dateLocal
      });
    }
    return { ok: true, txns };
  }

  // src/core/zen/plan.ts
  function planMessages(items, ctx, accountIds, existing) {
    const mapped = [];
    const plans = /* @__PURE__ */ new Map();
    for (const { msgId, txn } of items) {
      const r = toZenTransactions(txn, ctx);
      if (!r.ok) {
        plans.set(msgId, { msgId, status: "unmapped", reason: r.reason, decisions: [], creates: [] });
        continue;
      }
      const unknownAcc = r.txns.flatMap((t) => [t.incomeAccount, t.outcomeAccount]).find((a) => !accountIds.has(a));
      if (unknownAcc) {
        plans.set(msgId, {
          msgId,
          status: "unmapped",
          reason: `счёт ${unknownAcc} из ACCOUNTS не найден в Дзен-мани (или в архиве)`,
          decisions: [],
          creates: []
        });
        continue;
      }
      mapped.push({ msgId, txns: r.txns });
    }
    const decisions = planWrites(mapped.flatMap((m) => m.txns), existing);
    let k = 0;
    for (const m of mapped) {
      const ds = decisions.slice(k, k += m.txns.length);
      const dup = ds.find((d) => d.action === "manual-duplicate");
      if (dup && dup.action === "manual-duplicate") {
        const amount = dup.match.outcome || dup.match.income;
        plans.set(m.msgId, {
          msgId: m.msgId,
          status: "duplicate",
          reason: `похожая ручная операция ${dup.match.date} на ${amount} (id ${dup.match.id})`,
          decisions: ds,
          creates: []
        });
        continue;
      }
      const creates = ds.filter((d) => d.action === "create").map((d) => d.txn);
      plans.set(m.msgId, { msgId: m.msgId, status: creates.length ? "create" : "done", decisions: ds, creates });
    }
    return items.map((i) => plans.get(i.msgId));
  }
  var maskLongDigits = (s) => s.replace(/(?<!vcb:)\b\d{8,}/g, (d) => "****" + d.slice(-4));
  function formatDecision(d) {
    const t = d.txn;
    const sum = t.outcome > 0 && t.income > 0 ? `${t.outcome}→${t.income}` : t.outcome > 0 ? `-${t.outcome}` : `+${t.income}`;
    const acc = t.outcomeAccount === t.incomeAccount ? t.outcomeAccount.slice(0, 8) : `${t.outcomeAccount.slice(0, 8)}→${t.incomeAccount.slice(0, 8)}`;
    return `${d.action} id=${t.id} ${t.date} ${sum} acc=${acc} comment="${maskLongDigits(t.comment ?? "")}"`;
  }

  // src/gas/main.ts
  var L = {
    inbox: "zen/inbox",
    done: "zen/done",
    // записано в Дзен-мани (или уже было записано)
    dryrun: "zen/dryrun",
    // готово к записи, но режим dry-run
    duplicate: "zen/duplicate",
    // похоже на операцию, внесённую вручную, — не записано
    unparsed: "zen/unparsed",
    // письмо или счёт не распознаны
    quarantine: "zen/quarantine",
    // не прошла проверка отправителя
    error: "zen/error"
  };
  var RANK = ["done", "dryrun", "duplicate", "unparsed", "quarantine", "error"];
  var FINAL = /* @__PURE__ */ new Set(["done", "duplicate", "quarantine"]);
  var BATCH = 30;
  var KEEP_IDS = 300;
  var MAX_RETRIES = 5;
  var label = (name) => GmailApp.getUserLabelByName(name) ?? GmailApp.createLabel(name);
  function accountsMap(props) {
    const raw = props.getProperty("ACCOUNTS");
    const out = {};
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw))) out[k.replace(/\D/g, "")] = v;
    return out;
  }
  var isWriteMode = (props) => (props.getProperty("MODE") ?? "").trim().toLowerCase() === "write";
  function zenDiff(token, body) {
    if ("deletion" in body) throw new Error("deletion в Дзен-мани не отправляем");
    const r = UrlFetchApp.fetch(ZEN_DIFF_URL, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + token },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    const code = r.getResponseCode();
    if (code === 401) throw new Error("Дзен-мани: 401 — токен ZEN_TOKEN недействителен");
    if (code !== 200) throw new Error(`Дзен-мани: HTTP ${code} ${r.getContentText().slice(0, 200)}`);
    return JSON.parse(r.getContentText());
  }
  function syncToZen(pending, accounts, token, write, tag) {
    const now = Math.floor(Date.now() / 1e3);
    const full = zenDiff(token, fullFetchRequest(now));
    const meta = readMeta(full);
    const plans = planMessages(
      pending.map((m) => ({ msgId: m.id, txn: m.txn })),
      { accounts, userId: meta.userId, instruments: meta.instruments, now },
      meta.accountIds,
      readTransactions(full)
    );
    const byId = new Map(pending.map((m) => [m.id, m]));
    for (const p of plans) {
      for (const d of p.decisions) console.log(`${tag} msg=${p.msgId} ${formatDecision(d)}`);
      if (p.reason) console.log(`${tag} msg=${p.msgId} ${p.status}: ${p.reason}`);
      const m = byId.get(p.msgId);
      m.result = p.status === "done" ? "done" : p.status === "duplicate" ? "duplicate" : p.status === "unmapped" ? "unparsed" : write ? null : "dryrun";
    }
    const toCreate = plans.filter((p) => p.status === "create");
    if (!write || !toCreate.length) return;
    const txns = toCreate.flatMap((p) => p.creates);
    const resp = zenDiff(token, writeRequest(meta.serverTimestamp, txns, now));
    const missing = new Set(missingAfterWrite(resp, txns.map((t) => t.id)));
    for (const p of toCreate) {
      const lost = p.creates.filter((t) => missing.has(t.id));
      byId.get(p.msgId).result = lost.length ? "error" : "done";
      console.log(`${tag} msg=${p.msgId} ${lost.length ? "НЕ подтверждено сервером: " + lost.map((t) => t.id).join(", ") : "записано"}`);
    }
  }
  function run() {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(1e3)) return;
    try {
      const props = PropertiesService.getScriptProperties();
      const inbox = label(L.inbox);
      const threads = inbox.getThreads(0, BATCH);
      if (!threads.length) return;
      const write = isWriteMode(props);
      const tag = write ? "[write]" : "[dry-run]";
      const accounts = accountsMap(props);
      const own = Object.keys(accounts);
      console.log(`${tag} свои счета (ACCOUNTS): ${own.map(maskAccount).join(", ") || "не заданы"}`);
      const seen = (props.getProperty("PROCESSED_IDS") ?? "").split(",").filter(Boolean);
      const seenSet = new Set(seen);
      const retries = JSON.parse(props.getProperty("RETRIES") ?? "{}");
      const msgs = [];
      const broken = /* @__PURE__ */ new Set();
      threads.forEach((thread, i) => {
        try {
          for (const m of thread.getMessages()) {
            const id = m.getId();
            if (seenSet.has(id)) {
              console.log(`${tag} skip msg=${id}: уже обработано`);
              continue;
            }
            const out = processEmail({ id, from: m.getFrom(), html: m.getBody(), raw: m.getRawContent() }, own);
            console.log(`${tag} ${formatLog(id, out)}`);
            msgs.push(out.status === "parsed" ? { thread: i, id, result: null, txn: out.txn } : { thread: i, id, result: out.status });
          }
        } catch (e) {
          console.error(`ошибка в треде ${thread.getId()}: ${e instanceof Error ? e.stack : String(e)}`);
          broken.add(i);
        }
      });
      const pending = msgs.filter((m) => m.txn);
      const retryThreads = /* @__PURE__ */ new Set();
      if (pending.length) {
        const token = props.getProperty("ZEN_TOKEN");
        if (!token) {
          console.error(`${tag} не задано свойство ZEN_TOKEN — проверить дубли и записать нельзя`);
          pending.forEach((m) => m.result = "error");
        } else {
          try {
            syncToZen(pending, accounts, token, write, tag);
            pending.forEach((m) => delete retries[m.id]);
          } catch (e) {
            console.error(`${tag} сбой Дзен-мани: ${e instanceof Error ? e.message : String(e)}`);
            for (const m of pending) {
              const n = (retries[m.id] ?? 0) + 1;
              if (n >= MAX_RETRIES) {
                m.result = "error";
                delete retries[m.id];
              } else {
                m.result = null;
                retries[m.id] = n;
                retryThreads.add(m.thread);
                console.log(`${tag} msg=${m.id}: повтор ${n}/${MAX_RETRIES - 1} в следующем запуске`);
              }
            }
          }
        }
      }
      threads.forEach((thread, i) => {
        if (retryThreads.has(i)) return;
        let worst = broken.has(i) ? RANK.indexOf("error") : -1;
        for (const m of msgs) if (m.thread === i && m.result) worst = Math.max(worst, RANK.indexOf(m.result));
        if (worst >= 0) thread.addLabel(label(L[RANK[worst]]));
        thread.removeLabel(inbox);
      });
      for (const m of msgs) {
        if (m.result && FINAL.has(m.result) && !seenSet.has(m.id)) {
          seen.push(m.id);
          seenSet.add(m.id);
        }
      }
      props.setProperty("PROCESSED_IDS", seen.slice(-KEEP_IDS).join(","));
      props.setProperty("RETRIES", JSON.stringify(retries));
    } finally {
      lock.releaseLock();
    }
  }
  function checkZen() {
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty("ZEN_TOKEN");
    if (!token) {
      console.error("Не задано свойство ZEN_TOKEN.");
      return;
    }
    const now = Math.floor(Date.now() / 1e3);
    const meta = readMeta(zenDiff(token, { currentClientTimestamp: now, serverTimestamp: now, forceFetch: ["user", "instrument", "account"] }));
    console.log(`Токен работает. Пользователь ${meta.userId}, VND = ${meta.instruments.VND ?? "не найден"}.`);
    for (const [num, uuid] of Object.entries(accountsMap(props))) {
      console.log(`${maskAccount(num)} → ${uuid}: ${meta.accountIds.has(uuid) ? "счёт найден" : "НЕТ такого счёта (или он в архиве)"}`);
    }
    console.log(`Режим: ${isWriteMode(props) ? "write — запись включена" : "dry-run — запись выключена"}.`);
  }
  function install() {
    Object.keys(L).forEach((k) => label(L[k]));
    uninstall();
    ScriptApp.newTrigger("run").timeBased().everyMinutes(5).create();
    console.log("Метки созданы, таймер установлен (каждые 5 минут).");
  }
  function uninstall() {
    for (const t of ScriptApp.getProjectTriggers()) {
      if (t.getHandlerFunction() === "run") ScriptApp.deleteTrigger(t);
    }
  }
  function dumpSample() {
    const thread = GmailApp.search("from:" + VCB_SENDER, 0, 1)[0];
    if (!thread) {
      console.log("Писем от банка не найдено.");
      return;
    }
    const msgs = thread.getMessages();
    const m = msgs[msgs.length - 1];
    const me = Session.getEffectiveUser().getEmail();
    GmailApp.createDraft(me, "zen sample: " + m.getSubject(), anonymizeHtml(m.getBody()));
    console.log("Обезличенный образец сохранён в «Черновики».");
  }
  return __toCommonJS(main_exports);
})();

function run() { return ZenApp.run(); }
function checkZen() { return ZenApp.checkZen(); }
function install() { return ZenApp.install(); }
function uninstall() { return ZenApp.uninstall(); }
function dumpSample() { return ZenApp.dumpSample(); }

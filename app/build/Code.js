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
  function processEmail(msg, ownAccounts2) {
    const auth = parseAuthResults(topAuthResultsHeader(msg.raw), VCB_ORG_DOMAIN);
    if (address(msg.from) !== VCB_SENDER) return { status: "quarantine", reason: "чужой отправитель", auth };
    if (!isTrusted(auth)) return { status: "quarantine", reason: "не прошла проверка DKIM/DMARC", auth };
    const r = parseTransferReceipt(msg.html, { gmailMessageId: msg.id, auth, ownAccounts: ownAccounts2 });
    return r.ok ? { status: "parsed", txn: r.txn } : { status: "unparsed", reason: r.error, auth };
  }
  var maskAccount = (a) => a ? "****" + a.slice(-4) : "-";
  var authStr = (a) => ["dkim", "spf", "dmarc"].map((k) => `${k}=${a[k] ? "pass" : "no"}`).join(" ");
  function formatLog(id, o) {
    if (o.status !== "parsed") return `${o.status} msg=${id} причина: ${o.reason} (${authStr(o.auth)})`;
    const t = o.txn;
    return `parsed msg=${id} order=${t.orderNumber} ${t.occurredAtLocal} ${t.amount} ${t.currency} fee=${t.feeAmount} kind=${t.kind} debit=${maskAccount(t.debitAccount)} credit=${maskAccount(t.creditAccount)} (${authStr(t.auth)})`;
  }

  // src/gas/main.ts
  var L = {
    inbox: "zen/inbox",
    dryrun: "zen/dryrun",
    // разобрано, но не записано (dry-run)
    unparsed: "zen/unparsed",
    quarantine: "zen/quarantine",
    error: "zen/error"
  };
  var RANK = ["dryrun", "unparsed", "quarantine", "error"];
  var BATCH = 30;
  var KEEP_IDS = 300;
  var label = (name) => GmailApp.getUserLabelByName(name) ?? GmailApp.createLabel(name);
  function ownAccounts(props) {
    const raw = props.getProperty("ACCOUNTS");
    return raw ? Object.keys(JSON.parse(raw)).map((k) => k.replace(/\D/g, "")) : [];
  }
  function run() {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(1e3)) return;
    try {
      const props = PropertiesService.getScriptProperties();
      const own = ownAccounts(props);
      const seen = (props.getProperty("PROCESSED_IDS") ?? "").split(",").filter(Boolean);
      const seenSet = new Set(seen);
      const inbox = label(L.inbox);
      const threads = inbox.getThreads(0, BATCH);
      if (threads.length) console.log(`[dry-run] свои счета (ACCOUNTS): ${own.map(maskAccount).join(", ") || "не заданы"}`);
      for (const thread of threads) {
        let worst = -1;
        try {
          for (const m of thread.getMessages()) {
            const id = m.getId();
            if (seenSet.has(id)) {
              console.log(`[dry-run] skip msg=${id}: уже обработано`);
              continue;
            }
            const out = processEmail({ id, from: m.getFrom(), html: m.getBody(), raw: m.getRawContent() }, own);
            console.log("[dry-run] " + formatLog(id, out));
            const res = out.status === "parsed" ? "dryrun" : out.status;
            worst = Math.max(worst, RANK.indexOf(res));
            if (res === "unparsed") continue;
            seen.push(id);
            seenSet.add(id);
          }
        } catch (e) {
          console.error(`ошибка в треде ${thread.getId()}: ${e instanceof Error ? e.stack : String(e)}`);
          worst = RANK.indexOf("error");
        }
        if (worst >= 0) thread.addLabel(label(L[RANK[worst]]));
        thread.removeLabel(inbox);
      }
      props.setProperty("PROCESSED_IDS", seen.slice(-KEEP_IDS).join(","));
    } finally {
      lock.releaseLock();
    }
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
function install() { return ZenApp.install(); }
function uninstall() { return ZenApp.uninstall(); }
function dumpSample() { return ZenApp.dumpSample(); }

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
    dailySummary: () => dailySummary,
    dumpGrabSample: () => dumpGrabSample,
    dumpSample: () => dumpSample,
    install: () => install,
    run: () => run,
    tgSetup: () => tgSetup,
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
    remitter: ["Tên người chuyển tiền", "Tên tài khoản nguồn", "Remitter's name"],
    creditAccount: [
      "Tài khoản người hưởng",
      "Tài khoản hưởng",
      "Credit Account",
      "Tài khoản/ Thẻ người hưởng",
      "Credit Account/ Card",
      "Số thẻ chuyển đến",
      "Destination Card Number"
    ],
    // В переводе «на счёт/карту» Credit Account — виртуальный QR-счёт, настоящий номер — здесь.
    accountNumber: ["Số tài khoản thụ hưởng", "Account number"],
    billCode: ["Mã hóa đơn/Mã khách hàng", "Bill code/Customer code"],
    beneficiaryName: ["Tên người hưởng", "Beneficiary Name"],
    beneficiaryBank: ["Tên ngân hàng hưởng", "Beneficiary Bank Name"],
    amount: ["Số tiền", "Amount", "Số tiền trích nợ", "Debit Amount"],
    creditAmount: ["Số tiền ghi có", "Credit Amount"],
    exchangeRate: ["Tỷ giá quy đổi", "Exchange Rate"],
    chargeCode: ["Loại phí", "Charge Code"],
    chargeAmount: ["Số tiền phí", "Charge Amount", "Fee Amount"],
    details: ["Nội dung chuyển tiền", "Nội dung chuyểntiền", "Nội dung thanh toán", "Details of Payment"]
  };
  var REQUIRED = ["dateTime", "orderNumber", "amount", "chargeAmount"];
  var key = (s) => normalizeText(s).toLowerCase().replace(/[’`]/g, "'");
  var LABEL_INDEX = /* @__PURE__ */ new Map();
  for (const f of Object.keys(LABELS)) for (const l of LABELS[f]) LABEL_INDEX.set(key(l), f);
  function asLabel(cell) {
    const colon = cell.indexOf(":");
    const head = colon >= 0 ? cell.slice(0, colon) : cell;
    const inline = colon >= 0 ? normalizeText(cell.slice(colon + 1)) : "";
    const whole = LABEL_INDEX.get(key(head));
    if (whole !== void 0) return { field: whole, inline };
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
    if (f.creditAmount !== void 0) {
      const credited = parseVcbAmount(f.creditAmount);
      if (!credited || credited.amount !== amount.amount || credited.currency !== amount.currency) {
        return { ok: false, error: "суммы списания и зачисления различаются" };
      }
    }
    const fee = parseVcbFee(runs.chargeAmount ?? []);
    if ("error" in fee) return { ok: false, error: fee.error };
    if (fee.amount > 0 && fee.currency !== amount.currency) return { ok: false, error: "валюта комиссии отличается" };
    const orderNumber = f.orderNumber.replace(/\s/g, "");
    if (!/^[A-Za-z0-9-]+$/.test(orderNumber)) return { ok: false, error: "не разобран Order Number" };
    const debitAccount = digits(f.debitAccount);
    const creditAccount = digits(f.accountNumber) ?? digits(f.creditAccount);
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
        billCode: f.billCode,
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

  // src/core/receipts/grab/e-receipt.ts
  var MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  var monthIndex = (name) => MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  var p2 = (n) => String(n).padStart(2, "0");
  var validDate = (y, mo, d) => mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
  function parseGrabAmount(s) {
    const t = s.trim();
    if (!/^(?:\d{1,3}(?:[.,]\d{3})+|\d+)$/.test(t)) return null;
    const n = Number(t.replace(/[.,]/g, ""));
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  function foodDateTime(text) {
    const m = /\b(\d{1,2}) ([A-Za-z]{3}) (\d{2}) (\d{1,2}):(\d{2}) ([+-])(\d{2})(\d{2})\b/.exec(text);
    if (!m) return null;
    const [d, y, hh, mi, oh, om] = [m[1], m[3], m[4], m[5], m[7], m[8]].map(Number);
    const mo = monthIndex(m[2]) + 1;
    const year = 2e3 + y;
    if (!validDate(year, mo, d) || hh > 23 || mi > 59 || oh > 14 || om > 59) return null;
    const offsetMin = (m[6] === "-" ? -1 : 1) * (oh * 60 + om);
    const local = new Date(Date.UTC(year, mo - 1, d, hh, mi) + (7 * 60 - offsetMin) * 6e4);
    const dateLocal = `${local.getUTCFullYear()}-${p2(local.getUTCMonth() + 1)}-${p2(local.getUTCDate())}`;
    return { occurredAtLocal: `${dateLocal}T${p2(local.getUTCHours())}:${p2(local.getUTCMinutes())}:00+07:00`, dateLocal };
  }
  function rideDateTime(text) {
    const m = /Picked up on (\d{1,2}) ([A-Za-z]+) (\d{4})/.exec(text);
    if (!m) return null;
    const [d, y] = [Number(m[1]), Number(m[3])];
    const mo = monthIndex(m[2]) + 1;
    if (!validDate(y, mo, d)) return null;
    const dateLocal = `${y}-${p2(mo)}-${p2(d)}`;
    const trip = text.indexOf("Your Trip");
    const t = trip >= 0 ? /\b(\d{1,2}):(\d{2}) ?(AM|PM)\b/.exec(text.slice(trip)) : null;
    if (!t) return { dateLocal };
    const h12 = Number(t[1]);
    const mi = Number(t[2]);
    if (h12 < 1 || h12 > 12 || mi > 59) return { dateLocal };
    const hh = h12 % 12 + (t[3] === "PM" ? 12 : 0);
    return { occurredAtLocal: `${dateLocal}T${p2(hh)}:${p2(mi)}:00+07:00`, dateLocal };
  }
  var AMOUNT = "(\\d[\\d.,]*)\\s*₫";
  function parseFood(text, ctx) {
    const orderId = /Mã đơn hàng\s+(A-[A-Z0-9]+)\b/.exec(text)?.[1];
    if (!orderId) return { ok: false, error: "не разобран номер заказа" };
    const total = parseGrabAmount(new RegExp(`Tổng cộng\\s*${AMOUNT}`).exec(text)?.[1] ?? "");
    if (total === null) return { ok: false, error: "не разобрана сумма" };
    const paid = parseGrabAmount(new RegExp(`BẠN TRẢ\\s*${AMOUNT}`).exec(text)?.[1] ?? "");
    if (paid === null) return { ok: false, error: "нет строки «BẠN TRẢ»" };
    if (paid !== total) return { ok: false, error: "итог и «BẠN TRẢ» различаются" };
    const dt = foodDateTime(text);
    if (!dt) return { ok: false, error: "не разобрана дата" };
    return {
      ok: true,
      receipt: {
        source: "grab-email",
        kind: "food",
        service: "GrabFood",
        gmailMessageId: ctx.gmailMessageId,
        orderId,
        ...dt,
        amount: total,
        currency: "VND",
        paymentMethod: /Bạn trả bằng:?\s*(.+?)\s+Chi tiết/.exec(text)?.[1],
        merchant: /Đặt từ\s+(.+?)\s+Giao đến/.exec(text)?.[1]
      }
    };
  }
  function parseRide(text, ctx) {
    const orderId = /Booking ID:\s*(A-[A-Z0-9]+)\b/.exec(text)?.[1];
    if (!orderId) return { ok: false, error: "не разобран номер поездки" };
    const total = parseGrabAmount(new RegExp(`Total Paid\\s*${AMOUNT}`).exec(text)?.[1] ?? "");
    if (total === null) return { ok: false, error: "не разобрана сумма" };
    const dt = rideDateTime(text);
    if (!dt) return { ok: false, error: "не разобрана дата" };
    const head = text.slice(0, text.indexOf("Booking ID:"));
    return {
      ok: true,
      receipt: {
        source: "grab-email",
        kind: "ride",
        service: /\bGrab[A-Z][A-Za-z0-9]*/.exec(head)?.[0] ?? "Grab",
        gmailMessageId: ctx.gmailMessageId,
        orderId,
        ...dt,
        amount: total,
        currency: "VND",
        paymentMethod: /Paid by\s+(\D+?)\s+\d[\d.,]*/.exec(text)?.[1]
      }
    };
  }
  function parseGrabReceiptCells(cells, ctx) {
    const text = cells.join(" ");
    if (text.includes("Mã đơn hàng") && text.includes("Đặt từ")) return parseFood(text, ctx);
    if (text.includes("Booking ID:") && text.includes("Picked up on")) return parseRide(text, ctx);
    return { ok: false, error: "неизвестный вид чека Grab" };
  }
  function parseGrabReceipt(html, ctx) {
    return parseGrabReceiptCells(htmlToCells(html), ctx);
  }

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
  var GRAB_SENDER = "no-reply@grab.com";
  var GRAB_ORG_DOMAIN = "grab.com";
  var GRAB_RECEIPT_SUBJECT = "Your Grab E-Receipt";
  function processReceiptEmail(msg) {
    const auth = parseAuthResults(topAuthResultsHeader(msg.raw), GRAB_ORG_DOMAIN);
    if (address(msg.from) !== GRAB_SENDER) return { status: "quarantine", reason: "чужой отправитель", auth };
    if (!isTrusted(auth)) return { status: "quarantine", reason: "не прошла проверка DKIM/DMARC", auth };
    if (msg.subject.trim() !== GRAB_RECEIPT_SUBJECT) return { status: "skip", reason: "не чек" };
    const r = parseGrabReceipt(msg.html, { gmailMessageId: msg.id });
    return r.ok ? { status: "receipt", receipt: r.receipt } : { status: "unparsed", reason: r.error, auth };
  }
  var maskAccount = (a) => a ? "****" + a.slice(-4) : "-";
  var authStr = (a) => ["dkim", "spf", "dmarc"].map((k) => `${k}=${a[k] ? "pass" : "no"}`).join(" ");
  function formatLog(id, o) {
    if (o.status !== "parsed") return `${o.status} msg=${id} причина: ${o.reason} (${authStr(o.auth)})`;
    const t = o.txn;
    return `parsed msg=${id} order=${t.orderNumber} ${t.occurredAtLocal} ${t.amount} ${t.currency} fee=${t.feeAmount} kind=${t.kind} debit=${maskAccount(t.debitAccount)} credit=${maskAccount(t.creditAccount)} (${authStr(t.auth)})`;
  }

  // src/core/zen/rules.ts
  function foldText(s) {
    return s.normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/g, "d").toLowerCase().replace(/\s+/g, " ").trim();
  }
  var tagKey = (title) => title.trim().toLowerCase();
  function compileRules(rules, tagsByTitle) {
    const out = [];
    const errors = [];
    rules.forEach((rule, i) => {
      const where = `правило ${i + 1} (${rule.match ?? "?"})`;
      if (!rule || typeof rule.match !== "string" || !rule.match.trim() || typeof rule.tag !== "string" && rule.tag !== null) {
        errors.push(`${where}: нужны поля match и tag`);
        return;
      }
      const tagId = rule.tag === null ? null : tagsByTitle[tagKey(rule.tag)];
      if (tagId === void 0) {
        errors.push(`${where}: нет категории «${rule.tag}» в Дзен-мани`);
        return;
      }
      let test;
      const re = /^\/(.+)\/$/.exec(rule.match);
      if (re) {
        try {
          const rx = new RegExp(re[1], "i");
          test = (s) => rx.test(s);
        } catch {
          errors.push(`${where}: неверная регулярка`);
          return;
        }
      } else {
        const needle = foldText(rule.match);
        test = (s) => s.includes(needle);
      }
      out.push({ rule, tagId, test });
    });
    return { rules: out, errors };
  }
  var BUSINESS = /(^| )(ho kinh doanh|hkd|cong ty|cty|ct cp|ctcp|tnhh|jsc|shop|store|mart|market|tiem|nha thuoc|nha hang|quan|food|cafe|coffee|momo|payoo|baokim|vnpay|evn|vms)( |$)|_/;
  function looksLikePerson(name) {
    const n = foldText(name ?? "");
    return n !== "" && !BUSINESS.test(n);
  }
  function conditionsOk(rule, t) {
    if (rule.amountMin !== void 0 && t.amount < rule.amountMin) return false;
    if (rule.amountMax !== void 0 && t.amount >= rule.amountMax) return false;
    if (rule.multipleOf !== void 0 && t.amount % rule.multipleOf !== 0) return false;
    if (rule.person && !(t.kind === "expense" && looksLikePerson(t.beneficiaryName))) return false;
    return true;
  }
  function findRule(t, rules) {
    if (t.kind !== "expense" && t.kind !== "income") return void 0;
    const payee = foldText((t.kind === "expense" ? t.beneficiaryName : t.remitter) ?? "");
    const details = foldText(t.details ?? "");
    return rules.find(({ rule, test }) => {
      if (!conditionsOk(rule, t)) return false;
      const f = rule.field ?? "any";
      return (f === "payee" || f === "any") && payee !== "" && test(payee) || (f === "details" || f === "any") && details !== "" && test(details);
    });
  }

  // src/core/zen/evidence.ts
  var nextDay = (iso) => new Date(Date.parse(iso) + 864e5).toISOString().slice(0, 10);
  function grabEvidence(r) {
    if (r.kind !== "food") return null;
    const late = r.occurredAtLocal !== void 0 && Number(r.occurredAtLocal.slice(11, 13)) >= 23;
    return {
      source: "grab",
      id: r.orderId,
      msgId: r.gmailMessageId,
      dateLocal: r.dateLocal,
      dates: late ? [r.dateLocal, nextDay(r.dateLocal)] : [r.dateLocal],
      amount: r.amount,
      currency: r.currency,
      tagTitle: "Доставка еды",
      note: r.merchant,
      personOnly: true
    };
  }
  var evidenceMarker = (e) => `[${e.source}:${e.id}]`;
  var isScriptOp = (t) => /\[vcb:[^\]]+\]/.test(t.comment ?? "") && !/\[vcb:[^\]]+:fee\]/.test(t.comment ?? "");
  var hasEvidence = (t) => /\[(?!vcb:)[a-z]+:[^\]]+\]/.test(t.comment ?? "");
  var untouched = (t) => t.changed - t.created <= 60;
  var DAY = 864e5;
  function reconcile(evidences, creates, existing, ctx) {
    const outCreates = [...creates];
    const alive = existing.filter((t) => !t.deleted);
    const updates = [];
    const used = /* @__PURE__ */ new Set();
    const outcomes = evidences.map((ev) => {
      const mark = evidenceMarker(ev);
      if ([...outCreates, ...alive].some((t) => (t.comment ?? "").includes(mark))) return { status: "already", ev };
      const tagId = ctx.tagsByTitle[tagKey(ev.tagTitle)];
      if (tagId === void 0) return { status: "no-tag", ev };
      const instrument = ctx.instruments[ev.currency];
      const fits = (t) => !used.has(t.id) && t.outcome === ev.amount && t.income === 0 && t.outcomeAccount === t.incomeAccount && ctx.ownAccounts.has(t.outcomeAccount) && t.outcomeInstrument === instrument && ev.dates.includes(t.date);
      const scriptFits = (t) => fits(t) && isScriptOp(t) && !hasEvidence(t) && (!ev.personOnly || looksLikePerson(t.originalPayee ?? t.payee ?? void 0));
      const newIdx = outCreates.flatMap((t, i) => scriptFits(t) ? [i] : []);
      const old = alive.filter(scriptFits);
      if (newIdx.length + old.length > 1) return { status: "ambiguous", ev, count: newIdx.length + old.length };
      if (newIdx.length + old.length === 1) {
        const target = newIdx.length ? "create" : "existing";
        const op = newIdx.length ? outCreates[newIdx[0]] : old[0];
        const current = op.tag?.[0];
        const mayRetag = current === void 0 || ctx.heuristicTagIds.has(current) || target === "existing" && untouched(op);
        const txn = {
          ...op,
          tag: mayRetag ? [tagId] : op.tag,
          comment: [op.comment, ev.note, mark].filter(Boolean).join(" "),
          ...target === "existing" ? { changed: ctx.now } : {}
        };
        used.add(op.id);
        if (target === "create") outCreates[newIdx[0]] = txn;
        else updates.push(txn);
        return { status: "applied", ev, target, txn, ...!mayRetag && current !== tagId ? { keptTag: current } : {} };
      }
      const manual = alive.find((t) => fits(t) && !(t.comment ?? "").includes("[vcb:"));
      if (manual) {
        used.add(manual.id);
        return { status: "manual", ev, match: manual };
      }
      const age = Math.round((Date.parse(ctx.today) - Date.parse(ev.dateLocal)) / DAY);
      return { status: age >= (ctx.waitDays ?? 3) ? "expired" : "waiting", ev };
    });
    return { outcomes, creates: outCreates, updates };
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
      accountIds: new Set((d.account ?? []).filter((a) => !a.archive).map((a) => a.id)),
      tagsByTitle: Object.fromEntries((d.tag ?? []).map((t) => [tagKey(t.title), t.id])),
      tagTitles: Object.fromEntries((d.tag ?? []).map((t) => [t.id, t.title.trim()]))
    };
  }
  var readTransactions = (resp) => resp.transaction ?? [];
  var readFullTransactions = (resp) => resp.transaction ?? [];
  function writeRequest(serverTimestamp, txns, now) {
    return { currentClientTimestamp: now, serverTimestamp, transaction: txns };
  }
  function missingAfterWrite(resp, ids) {
    const got = new Set(readTransactions(resp).filter((t) => !t.deleted).map((t) => t.id));
    return ids.filter((id) => !got.has(id));
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

  // src/core/zen/dedup.ts
  var markerName = (comment) => /\[(vcb:[^\]]+)\]/.exec(comment ?? "")?.[1];
  var DAY2 = 864e5;
  var dayDiff = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY2;
  var INEXACT_TEXT = {
    "round-up": "сумма округлена вверх",
    "first-digits": "совпадают первые цифры",
    typo: "похоже на опечатку в сумме"
  };
  var inexactText = (k) => INEXACT_TEXT[k];
  var ROUND_UP_MAX = 3e3;
  var UNITS = [];
  for (let p = 100; p <= 1e7; p *= 10) UNITS.push(p, p * 5);
  function isRoundedUp(bank, manual) {
    if (manual <= bank) return false;
    for (const unit of UNITS) {
      if (bank % unit === 0 || manual % unit !== 0) continue;
      if (manual !== Math.ceil(bank / unit) * unit) continue;
      if (unit <= 1e3) return true;
      const isFive = String(unit)[0] === "5";
      const over = manual - bank;
      if (over <= ROUND_UP_MAX && over <= unit / 2 && manual / unit >= (isFive ? 20 : 10)) return true;
    }
    return false;
  }
  function isFirstDigits(bank, manual) {
    for (const unit of UNITS) {
      if (bank % unit === 0 || manual % unit !== 0 || String(unit)[0] === "5") continue;
      if (unit > 1e3 && bank < unit * 100) continue;
      const down = Math.floor(bank / unit) * unit;
      if (down > 0 && manual === down) return true;
    }
    return false;
  }
  function isTypo(bank, manual) {
    const b = String(bank);
    const m = String(manual);
    if (b.length !== m.length || b.length < 5 || b.slice(0, 3) !== m.slice(0, 3)) return false;
    const diff = [];
    for (let i = 0; i < b.length; i++) if (b[i] !== m[i]) diff.push(i);
    if (diff.length === 1) return true;
    return diff.length === 2 && diff[1] === diff[0] + 1 && b[diff[0]] === m[diff[1]] && b[diff[1]] === m[diff[0]];
  }
  function inexactMatch(bank, manual) {
    if (!Number.isInteger(bank) || !Number.isInteger(manual) || bank <= 0 || manual <= 0 || bank === manual) return void 0;
    if (isRoundedUp(bank, manual)) return "round-up";
    if (bank % 1e3 === 0) return void 0;
    if (isFirstDigits(bank, manual)) return "first-digits";
    if (isTypo(bank, manual)) return "typo";
    return void 0;
  }
  var KIND_RANK = { "round-up": 0, "first-digits": 1, typo: 2 };
  function sideAmount(c, e, own) {
    const isExpense = c.outcome > 0 && c.income === 0;
    const sameOut = e.outcomeAccount === c.outcomeAccount || isExpense && own.has(c.outcomeAccount) && own.has(e.outcomeAccount);
    if (c.outcome > 0 && e.outcome > 0 && sameOut) return e.outcome;
    if (c.income > 0 && e.income > 0 && e.incomeAccount === c.incomeAccount) return e.income;
    return void 0;
  }
  function planWrites(candidates, existing, redo = /* @__PURE__ */ new Set(), ownAccounts = /* @__PURE__ */ new Set()) {
    const byId = new Map(existing.map((e) => [e.id, e]));
    const aliveMarkers = new Set(existing.filter((e) => !e.deleted).map((e) => markerName(e.comment)).filter(Boolean));
    const manual = existing.filter((e) => !e.deleted && !(e.comment ?? "").includes("[vcb:"));
    const used = /* @__PURE__ */ new Set();
    const amountOf = (t) => t.outcome || t.income;
    const findExact = (txn) => manual.find((m) => !used.has(m.id) && dayDiff(m.date, txn.date) <= 1 && sideAmount(txn, m, ownAccounts) === amountOf(txn));
    const findInexact = (txn) => {
      let best;
      for (const m of manual) {
        if (used.has(m.id) || dayDiff(m.date, txn.date) > 1) continue;
        const amount = sideAmount(txn, m, ownAccounts);
        const why = amount === void 0 ? void 0 : inexactMatch(amountOf(txn), amount);
        if (amount === void 0 || !why) continue;
        const diff = Math.abs(amount - amountOf(txn));
        const better = !best || KIND_RANK[why] < KIND_RANK[best.why] || why === best.why && diff < best.diff;
        if (better) best = { m, why, diff };
      }
      return best;
    };
    const first = candidates.map((txn) => {
      const e = byId.get(txn.id);
      const name = markerName(txn.comment);
      if (e && !e.deleted || name && aliveMarkers.has(name)) return { action: "exists", txn };
      if (e) {
        if (!redo.has(txn.id) || !name) return { action: "deleted", txn };
        let n = 1;
        while (byId.has(uuidv5(`${name}:r${n}`))) n++;
        return { action: "restore", txn: { ...txn, id: uuidv5(`${name}:r${n}`) } };
      }
      if (redo.has(txn.id)) return { action: "create", txn };
      const match = findExact(txn);
      if (match) {
        used.add(match.id);
        return { action: "manual-duplicate", txn, match, fuzzy: false };
      }
      return null;
    });
    return first.map((d, i) => {
      if (d) return d;
      const txn = candidates[i];
      const found = /:fee\]/.test(txn.comment ?? "") ? void 0 : findInexact(txn);
      if (found) {
        used.add(found.m.id);
        return { action: "manual-duplicate", txn, match: found.m, fuzzy: true, why: found.why };
      }
      return { action: "create", txn };
    });
  }

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
    const rule = findRule(t, ctx.rules ?? []);
    const main = {
      ...blank(ctx),
      tag: rule?.tagId ? [rule.tagId] : null,
      id: vcbTxnId(t.orderNumber),
      incomeInstrument: instrument,
      incomeAccount,
      income,
      outcomeInstrument: instrument,
      outcomeAccount,
      outcome,
      payee: rule?.rule.payee ?? payee,
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
  function planMessages(items, ctx, accountIds, existing, redoOrders = /* @__PURE__ */ new Set()) {
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
    const redo = new Set([...redoOrders].flatMap((o) => [vcbTxnId(o), vcbTxnId(o, true)]));
    const own = new Set(Object.values(ctx.accounts));
    const decisions = planWrites(mapped.flatMap((m) => m.txns), existing, redo, own);
    let k = 0;
    for (const m of mapped) {
      const ds = decisions.slice(k, k += m.txns.length);
      const dup = ds.find((d) => d.action === "manual-duplicate");
      if (dup && dup.action === "manual-duplicate") {
        const amount = dup.match.outcome || dup.match.income;
        plans.set(m.msgId, {
          msgId: m.msgId,
          status: "duplicate",
          reason: `похожая ручная операция ${dup.match.date} на ${amount} (id ${dup.match.id})` + (dup.fuzzy ? ` — ${dup.why ? inexactText(dup.why) : "сумма отличается"}, проверить` : ""),
          decisions: ds,
          creates: []
        });
        continue;
      }
      const creates = ds.filter((d) => d.action === "create" || d.action === "restore").map((d) => d.txn);
      plans.set(m.msgId, { msgId: m.msgId, status: creates.length ? "create" : "done", decisions: ds, creates });
    }
    return items.map((i) => plans.get(i.msgId));
  }
  var maskLongDigits = (s) => s.replace(/(?<!vcb:)\b\d{8,}/g, (d) => "****" + d.slice(-4));
  function formatDecision(d, tagTitles = {}) {
    const t = d.txn;
    const sum = t.outcome > 0 && t.income > 0 ? `${t.outcome}→${t.income}` : t.outcome > 0 ? `-${t.outcome}` : `+${t.income}`;
    const acc = t.outcomeAccount === t.incomeAccount ? t.outcomeAccount.slice(0, 8) : `${t.outcomeAccount.slice(0, 8)}→${t.incomeAccount.slice(0, 8)}`;
    const tag = t.tag?.length ? t.tag.map((id) => tagTitles[id] ?? id).join(",") : "-";
    return `${d.action} id=${t.id} ${t.date} ${sum} acc=${acc} tag=${tag} comment="${maskLongDigits(t.comment ?? "")}"`;
  }

  // config/rules.json
  var rules_default = [
    {
      match: "/(^|[^a-z])evn/",
      tag: "Коммуналка",
      payee: "EVN (электричество)"
    },
    {
      match: "/\\bcap nuoc\\b/",
      tag: "Коммуналка"
    },
    {
      match: "/(?<![a-z0-9])(?:wincommerce|winmart|vinmart|win ?mart)/",
      field: "payee",
      tag: "Хотелки",
      payee: "WinMart"
    },
    {
      match: "/(?<![a-z0-9])(?:mini ?mart)/",
      field: "payee",
      tag: "Хотелки"
    },
    {
      match: "/(?<![a-z0-9])(?:tiem banh)/",
      field: "payee",
      tag: "Продукты"
    },
    {
      match: "/(?<![a-z0-9])(?:bach hoa xanh|bhx)/",
      field: "payee",
      tag: null,
      payee: "Bach Hoa Xanh"
    },
    {
      match: "/(?<![a-z0-9])(?:tien nha|thue nha|tien phong|thue phong|tien thue)/",
      field: "payee",
      tag: "Аренда"
    },
    {
      match: "/(?<![a-z0-9])(?:dien luc|tien dien)/",
      field: "payee",
      tag: "Коммуналка"
    },
    {
      match: "/(?<![a-z0-9])(?:cap thoat nuoc|tien nuoc|khawassco)/",
      field: "payee",
      tag: "Коммуналка"
    },
    {
      match: "/(?<![a-z0-9])(?:phi quan ly|phi dich vu|phi ve sinh|tien rac)/",
      field: "payee",
      tag: "Коммуналка"
    },
    {
      match: "/(?<![a-z0-9])(?:vms(?![a-z])|viettel|vinaphone|mobifone|vietnamobile|vnpt|fpt telecom|nap (tien )?dien thoai|nap the|top ?up|data [45]g|internet)/",
      field: "payee",
      tag: "Связь"
    },
    {
      match: "/(?<![a-z0-9])(?:visa ?run|e-?visa|xuat nhap canh|immigration|lanh su)/",
      field: "payee",
      tag: "Бюрократия"
    },
    {
      match: "/(?<![a-z0-9])(?:chatgpt|openai|claude|anthropic|cursor|copilot|figma|icons8|midjou?rney|telegram premium|yandex|netflix|spotify|youtube premium|icloud|google one|apple\\.com|glovo prime|shopee vip|phi thuong nien|phi quan ly tai khoan|phi sms|phi duy tri)/",
      field: "payee",
      tag: "Подписки"
    },
    {
      match: "/(?<![a-z0-9])(?:pickle)/",
      field: "payee",
      tag: "Пиклбол"
    },
    {
      match: "/(?<![a-z0-9])(?:cat ve sinh|cat litter)/",
      field: "payee",
      tag: "Наполнитель"
    },
    {
      match: "/(?<![a-z0-9])(?:vet clinic)/",
      field: "payee",
      tag: "Ветеринария"
    },
    {
      match: "/(?<![a-z0-9])(?:sheba|churu)/",
      field: "payee",
      tag: "Лакомства"
    },
    {
      match: "/(?<![a-z0-9])(?:royal canin|whiskas)/",
      field: "payee",
      tag: "Корм"
    },
    {
      match: "/(?<![a-z0-9])(?:pet ?shop|thu cung|pet mart|petmart)/",
      field: "payee",
      tag: "Кошки"
    },
    {
      match: "/(?<![a-z0-9])(?:decathlon)/",
      field: "payee",
      tag: "Спорт"
    },
    {
      match: "/(?<![a-z0-9])(?:massage|spa(?![a-z])|spf|sunscreen|barber|hair ?salon|guardian|watsons|hasaki|cocolux)/",
      field: "payee",
      tag: "Уход"
    },
    {
      match: "/(?<![a-z0-9])(?:nha thuoc|pharmacity|pharmacy|nha khoa|dental|benh vien|phong kham|hospital|clinic)/",
      field: "payee",
      tag: "Здоровье"
    },
    {
      match: "/(?<![a-z0-9])(?:vietjet|vietnam airlines|bamboo airways|airasia|agoda|booking|airbnb|traveloka|trip\\.com|hotel|khach san|homestay|hostel|duong sat|esim|futa|phuong trang|vexere)/",
      field: "payee",
      tag: "Путешествия"
    },
    {
      match: "/(?<![a-z0-9])(?:cgv|lotte cinema|beta cinema|galaxy cinema|steam|vinpearl|vinwonders|karaoke|bowling)/",
      field: "payee",
      tag: "Развлечения"
    },
    {
      match: "/(?<![a-z0-9])(?:taxi|xanh sm|be group|xang|petrolimex|pvoil|cay xang|rua xe|sua xe|parking|gui xe|giu xe|thue xe)/",
      field: "payee",
      tag: "Транспорт"
    },
    {
      match: "/(?<![a-z0-9])(?:grab(?! ?food))/",
      field: "payee",
      tag: "Транспорт",
      payee: "Grab",
      amountMax: 1e5
    },
    {
      match: "/(?<![a-z0-9])(?:grab)/",
      field: "payee",
      tag: "Доставка еды",
      payee: "Grab",
      amountMin: 1e5
    },
    {
      match: "/(?<![a-z0-9])(?:grab ?food|shopee ?food|befood|baemin|gofood|pizza(?! ?4p)|sushi)/",
      field: "payee",
      tag: "Доставка еды"
    },
    {
      match: "/(?<![a-z0-9])(?:pizza ?4p|burger king|kfc|lotteria|jollibee|mcdonald|bah?nh? mi|p burger|nha hang|restaurant|bistro|quan (an|com|pho|bun|nhau)|com (tam|ga|nieu)|pho (bo|ga)|bun (cha|bo)|egg bread)/",
      field: "payee",
      tag: "Рестораны"
    },
    {
      match: "/(?<![a-z0-9])(?:pepsi|bubble tea|tra sua|mixue|highlands|phuc long|katinat|starbucks|the coffee house|cong ca ?phe|gs25|7-?eleven|ministop|family ?mart)/",
      field: "payee",
      tag: "Хотелки"
    },
    {
      match: "/(?<![a-z0-9])(?:co\\.?op ?mart|co\\.?op ?food|lotte ?mart|big ?c|mega market|annam gourmet|top market|satra|sieu thi|tap hoa|trai cay|rau cu|thuc pham|nuoc(?! mam)|moon ?milk|cheadmarket|tomatoes)/",
      field: "payee",
      tag: "Продукты"
    },
    {
      match: "/(?<![a-z0-9])(?:giat (ui|say|la)|laundry)/",
      field: "payee",
      tag: "Хозяйственные расходы"
    },
    {
      match: "/(?<![a-z0-9])(?:jysk|ikea|noi that)/",
      field: "payee",
      tag: "Обстановка"
    },
    {
      match: "/(?<![a-z0-9])(?:ssd|dien may xanh|dienmayxanh|the gioi di dong|thegioididong|tgdd|fpt shop|cellphones)/",
      field: "payee",
      tag: "Техника"
    },
    {
      match: "/(?<![a-z0-9])(?:uniqlo)/",
      field: "payee",
      tag: "Одежда"
    },
    {
      match: "/(?<![a-z0-9])(?:qua tang)/",
      field: "payee",
      tag: "Подарки"
    },
    {
      match: "/(?<![a-z0-9])(?:shopee|lazada|tiktok ?shop|tiki(?![a-z])|shopeepay|baokim|payoo|momo|vnpay|zalopay|onepay)/",
      field: "payee",
      tag: null
    },
    {
      match: "/./",
      field: "payee",
      tag: "Доставка еды",
      person: true,
      amountMin: 14e4,
      amountMax: 45e4,
      multipleOf: 1e3
    }
  ];

  // src/core/notify.ts
  var fmtAmount = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  var fmtDay = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
  function txnLine(t, category) {
    const sign = t.kind === "income" ? "+" : t.kind === "transfer" ? "⇄ " : "−";
    const acc = t.kind === "income" ? maskAccount(t.creditAccount) : t.kind === "transfer" ? `${maskAccount(t.debitAccount)} → ${maskAccount(t.creditAccount)}` : maskAccount(t.debitAccount);
    const fee = t.feeAmount > 0 ? ` (+ комиссия ${fmtAmount(t.feeAmount)})` : "";
    return [`${fmtDay(t.dateLocal)} ${sign}${fmtAmount(t.amount)} ${t.currency}${fee}`, category ?? "без категории", acc].join(" · ");
  }
  function receiptLine(e, category) {
    const src = e.source.charAt(0).toUpperCase() + e.source.slice(1);
    return [`чек ${src} ${fmtDay(e.dateLocal)}`, `${fmtAmount(e.amount)} ${e.currency}`, category, e.note].filter(Boolean).join(" · ");
  }
  var gmailLink = (msgId) => `https://mail.google.com/mail/u/0/#all/${msgId}`;
  var ICON = {
    written: "✅",
    dryrun: "🧪",
    duplicate: "👯",
    unparsed: "❓",
    quarantine: "🚫",
    error: "❌",
    receipt: "🧾",
    receiptHint: "💡",
    receiptUnmatched: "🕳",
    receiptAmbiguous: "❓"
  };
  var TITLE = {
    written: "записано",
    dryrun: "dry-run, не записано",
    duplicate: "похоже на ручной ввод — не записано",
    unparsed: "не разобрано",
    quarantine: "карантин",
    error: "ошибка",
    receipt: "подтверждено чеком",
    receiptHint: "чек совпал с ручной операцией — не правлю",
    receiptUnmatched: "операция для чека не найдена",
    receiptAmbiguous: "несколько операций с такой суммой — не угадываю"
  };
  var PROBLEMS = /* @__PURE__ */ new Set(["duplicate", "unparsed", "quarantine", "error", "receiptAmbiguous"]);
  function buildRunMessage(events, system, notifyAll) {
    const shown = events.filter((e) => notifyAll || PROBLEMS.has(e.kind));
    if (!shown.length && !system.length) return null;
    const bad = system.length > 0 || shown.some((e) => PROBLEMS.has(e.kind));
    const out = [bad ? "⚠️ Дзен-мани: нужно внимание" : "Дзен-мани"];
    for (const s of system) out.push(`❗ ${s}`);
    for (const e of shown) {
      const parts = [`${ICON[e.kind]} ${e.line ?? TITLE[e.kind]}`];
      if (e.line && e.kind !== "written") parts.push(`   ${TITLE[e.kind]}`);
      if (e.reason) parts.push(`   ${e.reason}`);
      if (PROBLEMS.has(e.kind)) parts.push(`   ${gmailLink(e.msgId)}`);
      out.push(parts.join("\n"));
    }
    return truncate(out.join("\n"));
  }
  var truncate = (s, max = 4e3) => s.length <= max ? s : s.slice(0, max - 20) + "\n… (обрезано)";
  var emptyDay = () => ({
    written: 0,
    dryrun: 0,
    duplicate: 0,
    unparsed: 0,
    quarantine: 0,
    error: 0,
    receipt: 0,
    receiptHint: 0,
    receiptUnmatched: 0,
    receiptAmbiguous: 0,
    outcome: {},
    income: {}
  });
  var KEEP_DAYS = 14;
  function addStats(stats, day, events, txns) {
    const d = { ...emptyDay(), ...stats[day] };
    for (const e of events) {
      d[e.kind]++;
      const t = txns.get(e.msgId);
      if (e.kind !== "written" || !t) continue;
      const add = (bucket) => bucket[t.currency] = (bucket[t.currency] ?? 0) + t.amount + t.feeAmount;
      if (t.kind === "expense") add(d.outcome);
      if (t.kind === "income") add(d.income);
    }
    const out = { ...stats, [day]: d };
    for (const k of Object.keys(out).sort().slice(0, -KEEP_DAYS)) delete out[k];
    return out;
  }
  var DAY_MS = 864e5;
  var daysBetween = (fromIso, toIso) => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS);
  var sums = (b) => Object.entries(b).map(([cur, n]) => `${fmtAmount(n)} ${cur}`).join(", ");
  function buildSummary(today2, d, waiting, lastBankDay, write) {
    const s = d ?? emptyDay();
    const out = [`📊 Дзен-мани · ${fmtDay(today2)}${write ? "" : " · режим dry-run"}`];
    const spent = sums(s.outcome);
    const got = sums(s.income);
    out.push(`Записано операций: ${s.written}${spent ? ` · расходы ${spent}` : ""}${got ? ` · доходы ${got}` : ""}`);
    if (s.dryrun) out.push(`dry-run (не записано): ${s.dryrun}`);
    if (s.receipt) out.push(`Подтверждено чеками: ${s.receipt}`);
    const probs = ["duplicate", "unparsed", "quarantine", "error"].filter((k) => s[k]).map((k) => `${TITLE[k]}: ${s[k]}`);
    if (probs.length) out.push(`За день: ${probs.join("; ")}`);
    const wait = Object.entries(waiting).filter(([, n]) => n > 0);
    if (wait.length) out.push(`Ждут проверки в Gmail: ${wait.map(([l, n]) => `${l} — ${n}`).join(", ")} (после проверки снять ярлык)`);
    if (!lastBankDay) out.push("⚠️ Писем от банка ещё не было.");
    else {
      const n = daysBetween(lastBankDay, today2);
      if (n >= 3) out.push(`⚠️ Писем от банка не было ${n} дн. (последнее ${fmtDay(lastBankDay)}) — проверить фильтр и пересылку.`);
    }
    return truncate(out.join("\n"));
  }
  function throttle(state, key2, nowSec, hours = 6) {
    const last = state[key2];
    if (last !== void 0 && nowSec - last < hours * 3600) return { send: false, state };
    const next = {};
    for (const [k, t] of Object.entries(state)) if (nowSec - t < 7 * 86400) next[k] = t;
    next[key2] = nowSec;
    return { send: true, state: next };
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
  var R = {
    pending: "zen/receipt",
    done: "zen/receipt-done",
    // операция уточнена, уже была уточнена, совпала ручная, либо письмо не требует сверки
    dryrun: "zen/receipt-dryrun",
    // совпадение найдено, но режим dry-run
    unmatched: "zen/receipt-unmatched"
    // операция не появилась за WAIT_DAYS дней или кандидатов несколько
  };
  var R_RANK = ["done", "dryrun", "unmatched", "unparsed", "quarantine", "error"];
  var R_LABEL = {
    done: R.done,
    dryrun: R.dryrun,
    unmatched: R.unmatched,
    unparsed: L.unparsed,
    quarantine: L.quarantine,
    error: L.error
  };
  var R_FINAL = /* @__PURE__ */ new Set(["done", "unmatched", "quarantine"]);
  var WAIT_DAYS = 3;
  var KEEP_CHECKED = 100;
  var BATCH = 30;
  var KEEP_IDS = 300;
  var MAX_RETRIES = 5;
  var TZ = "Asia/Ho_Chi_Minh";
  var today = () => Utilities.formatDate(/* @__PURE__ */ new Date(), TZ, "yyyy-MM-dd");
  var WAITING = ["duplicate", "unparsed", "quarantine", "error"];
  var label = (name) => GmailApp.getUserLabelByName(name) ?? GmailApp.createLabel(name);
  function accountsMap(props) {
    const raw = props.getProperty("ACCOUNTS");
    const out = {};
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw))) out[k.replace(/\D/g, "")] = v;
    return out;
  }
  function loadRules(props, tagsByTitle, tag) {
    let own = [];
    const bad = [];
    const raw = props.getProperty("RULES");
    if (raw) {
      try {
        const v = JSON.parse(raw);
        if (Array.isArray(v)) own = v;
        else bad.push("RULES: ожидался массив [...]");
      } catch (e) {
        bad.push(`RULES: неверный JSON — ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const { rules, errors } = compileRules([...own, ...rules_default], tagsByTitle);
    const all = [...bad, ...errors];
    for (const e of all) console.error(`${tag} ${e}`);
    return { rules, errors: all };
  }
  function tgSend(props, text) {
    const token = props.getProperty("TG_TOKEN");
    const chat = props.getProperty("TG_CHAT_ID");
    if (!token || !chat) return false;
    try {
      const r = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({ chat_id: chat, text: truncate(text), disable_web_page_preview: true }),
        muteHttpExceptions: true
      });
      if (r.getResponseCode() !== 200) {
        console.error(`Telegram: HTTP ${r.getResponseCode()} ${r.getContentText().slice(0, 200)}`);
        return false;
      }
      return true;
    } catch (e) {
      console.error(`Telegram: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }
  function throttled(props, items) {
    let state = JSON.parse(props.getProperty("ALERTS") ?? "{}");
    const now = Math.floor(Date.now() / 1e3);
    const out = [];
    for (const it of items) {
      const r = throttle(state, it.key, now);
      state = r.state;
      if (r.send) out.push(it.text);
    }
    if (items.length) props.setProperty("ALERTS", JSON.stringify(state));
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
  function syncToZen(pending, accounts, token, write, tag, redo, sys, receipts) {
    const now = Math.floor(Date.now() / 1e3);
    const full = zenDiff(token, fullFetchRequest(now));
    const meta = readMeta(full);
    const { rules, errors } = loadRules(PropertiesService.getScriptProperties(), meta.tagsByTitle, tag);
    for (const e of errors) sys.push({ key: "rules:" + e, text: `Правила категорий: ${e}` });
    const plans = planMessages(
      pending.map((m) => ({ msgId: m.id, txn: m.txn })),
      { accounts, userId: meta.userId, instruments: meta.instruments, now, rules },
      meta.accountIds,
      readTransactions(full),
      redo
    );
    const creatable = plans.filter((p) => p.status === "create");
    const rec = reconcile(
      receipts.map((r) => r.ev),
      creatable.flatMap((p) => p.creates),
      readFullTransactions(full),
      {
        ownAccounts: new Set(Object.values(accounts)),
        instruments: meta.instruments,
        tagsByTitle: meta.tagsByTitle,
        heuristicTagIds: new Set(rules.filter((r) => r.rule.person && r.tagId).map((r) => r.tagId)),
        now,
        today: today(),
        waitDays: WAIT_DAYS
      }
    );
    let k = 0;
    for (const p of creatable) p.creates = rec.creates.slice(k, k += p.creates.length);
    const tagName = (ids) => ids?.length ? ids.map((id) => meta.tagTitles[id] ?? id).join(", ") : void 0;
    const awaiting = /* @__PURE__ */ new Map();
    rec.outcomes.forEach((o, i) => {
      const r = receipts[i];
      const ev = o.ev;
      const ref = `чек ${ev.source}:${ev.id} msg=${r.id}`;
      switch (o.status) {
        case "applied": {
          const kept = o.keptTag ? `категория оставлена: ${tagName([o.keptTag])}` : void 0;
          console.log(`${tag} ${ref}: ${o.target === "create" ? "уточняет новую операцию" : "обновляет операцию"} id=${o.txn.id} tag=${tagName(o.txn.tag) ?? "-"}${kept ? ` (${kept})` : ""}`);
          const reason = [write ? void 0 : "dry-run, не изменено", kept].filter(Boolean).join("; ") || void 0;
          r.event = { kind: "receipt", msgId: r.id, line: receiptLine(ev, tagName(o.txn.tag)), reason };
          r.result = write ? null : "dryrun";
          if (write) awaiting.set(r, o.txn.id);
          break;
        }
        case "already":
          console.log(`${tag} ${ref}: метка уже стоит на операции`);
          r.result = "done";
          break;
        case "manual":
          console.log(`${tag} ${ref}: совпала ручная операция id=${o.match.id} (${tagName(o.match.tag) ?? "без категории"}) — не правлю`);
          r.event = { kind: "receiptHint", msgId: r.id, line: receiptLine(ev), reason: `в учёте: ${tagName(o.match.tag) ?? "без категории"}` };
          r.result = "done";
          break;
        case "ambiguous":
          console.log(`${tag} ${ref}: ${o.count} операции с суммой ${fmtAmount(ev.amount)} — не угадываю`);
          r.event = { kind: "receiptAmbiguous", msgId: r.id, line: receiptLine(ev) };
          r.result = "unmatched";
          break;
        case "expired":
          console.log(`${tag} ${ref}: операция не появилась за ${WAIT_DAYS} дн.`);
          r.event = { kind: "receiptUnmatched", msgId: r.id, line: receiptLine(ev) };
          r.result = "unmatched";
          break;
        case "no-tag":
          sys.push({ key: "evidence-tag:" + ev.tagTitle, text: `Чеки: нет категории «${ev.tagTitle}» в Дзен-мани.` });
          r.result = null;
          break;
        default:
          console.log(`${tag} ${ref}: операции пока нет, жду`);
          r.result = null;
      }
    });
    const byId = new Map(pending.map((m) => [m.id, m]));
    for (const p of plans) {
      for (const d of p.decisions) console.log(`${tag} msg=${p.msgId} ${formatDecision(d, meta.tagTitles)}`);
      if (p.reason) console.log(`${tag} msg=${p.msgId} ${p.status}: ${p.reason}`);
      const m = byId.get(p.msgId);
      const main = p.creates[0] ?? p.decisions[0]?.txn;
      const category = tagName(main?.tag);
      m.line = txnLine(m.txn, category);
      m.reason = p.reason;
      m.result = p.status === "done" ? "done" : p.status === "duplicate" ? "duplicate" : p.status === "unmapped" ? "unparsed" : write ? null : "dryrun";
    }
    const toCreate = creatable;
    const txns = [...toCreate.flatMap((p) => p.creates), ...rec.updates];
    if (!write || !txns.length) return;
    const resp = zenDiff(token, writeRequest(meta.serverTimestamp, txns, now));
    const missing = new Set(missingAfterWrite(resp, txns.map((t) => t.id)));
    for (const [r, id] of awaiting) {
      r.result = missing.has(id) ? null : "done";
      if (missing.has(id)) {
        r.event = void 0;
        console.log(`${tag} чек msg=${r.id}: операция id=${id} не подтверждена сервером, повтор в следующем запуске`);
      }
    }
    for (const p of toCreate) {
      const lost = p.creates.filter((t) => missing.has(t.id));
      const m = byId.get(p.msgId);
      m.result = lost.length ? "error" : "done";
      m.created = !lost.length;
      if (lost.length) m.reason = "Дзен-мани не подтвердил запись — см. журнал";
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
      const rInbox = label(R.pending);
      const rThreads = rInbox.getThreads(0, BATCH);
      if (!threads.length && !rThreads.length) return;
      const write = isWriteMode(props);
      const tag = write ? "[write]" : "[dry-run]";
      const accounts = accountsMap(props);
      const own = Object.keys(accounts);
      console.log(`${tag} свои счета (ACCOUNTS): ${own.map(maskAccount).join(", ") || "не заданы"}`);
      const seen = (props.getProperty("PROCESSED_IDS") ?? "").split(",").filter(Boolean);
      const seenSet = new Set(seen);
      const retries = JSON.parse(props.getProperty("RETRIES") ?? "{}");
      const redo = new Set((props.getProperty("REDO") ?? "").split(/[\s,;]+/).filter(Boolean));
      if (redo.size) console.log(`${tag} REDO: ${[...redo].join(", ")}`);
      const msgs = [];
      const broken = /* @__PURE__ */ new Set();
      threads.forEach((thread, i) => {
        try {
          for (const m of thread.getMessages()) {
            const id = m.getId();
            if (seenSet.has(id) && !redo.size) {
              console.log(`${tag} skip msg=${id}: уже обработано`);
              continue;
            }
            const out = processEmail({ id, from: m.getFrom(), html: m.getBody(), raw: m.getRawContent() }, own);
            if (seenSet.has(id) && !(out.status === "parsed" && redo.has(out.txn.orderNumber))) {
              console.log(`${tag} skip msg=${id}: уже обработано`);
              continue;
            }
            console.log(`${tag} ${formatLog(id, out)}`);
            msgs.push(
              out.status === "parsed" ? { thread: i, id, result: null, txn: out.txn, line: txnLine(out.txn) } : { thread: i, id, result: out.status, reason: out.reason }
            );
          }
        } catch (e) {
          console.error(`ошибка в треде ${thread.getId()}: ${e instanceof Error ? e.stack : String(e)}`);
          broken.add(i);
        }
      });
      const rSeen = (props.getProperty("RECEIPT_IDS") ?? "").split(",").filter(Boolean);
      const rSeenSet = new Set(rSeen);
      const rChecked = (props.getProperty("RECEIPT_CHECKED") ?? "").split(",").filter(Boolean);
      const rCheckedSet = new Set(rChecked);
      const rMsgs = [];
      const rBroken = /* @__PURE__ */ new Set();
      rThreads.forEach((thread, i) => {
        try {
          for (const m of thread.getMessages()) {
            const id = m.getId();
            if (rSeenSet.has(id)) continue;
            const out = processReceiptEmail({ id, from: m.getFrom(), subject: m.getSubject(), html: m.getBody(), raw: m.getRawContent() });
            if (out.status !== "receipt") {
              console.log(`${tag} чек msg=${id}: ${out.status} — ${out.reason}`);
              const result = out.status === "skip" ? "done" : out.status;
              const event = out.status === "skip" ? void 0 : { kind: out.status, msgId: id, line: "чек Grab", reason: out.reason };
              rMsgs.push({ thread: i, id, result, reason: out.reason, event });
              continue;
            }
            const ev = grabEvidence(out.receipt);
            console.log(`${tag} чек msg=${id}: ${out.receipt.service} ${out.receipt.orderId} ${out.receipt.dateLocal} ${out.receipt.amount} ${out.receipt.currency}${ev ? "" : " — не сверяется"}`);
            rMsgs.push(ev ? { thread: i, id, result: null, ev } : { thread: i, id, result: "done" });
          }
        } catch (e) {
          console.error(`ошибка в треде чеков ${thread.getId()}: ${e instanceof Error ? e.stack : String(e)}`);
          rBroken.add(i);
        }
      });
      const waiting = rMsgs.filter((r) => r.ev);
      const expired = (ev) => (Date.parse(today()) - Date.parse(ev.dateLocal)) / 864e5 >= WAIT_DAYS;
      const receiptsNeedZen = waiting.some((r) => !rCheckedSet.has(r.id) || expired(r.ev));
      const sys = [];
      const pending = msgs.filter((m) => m.txn);
      const retryThreads = /* @__PURE__ */ new Set();
      if (pending.length || receiptsNeedZen) {
        const token = props.getProperty("ZEN_TOKEN");
        if (!token) {
          console.error(`${tag} не задано свойство ZEN_TOKEN — проверить дубли и записать нельзя`);
          sys.push({ key: "no-token", text: "Не задано свойство ZEN_TOKEN — записать в Дзен-мани нельзя." });
          pending.forEach((m) => m.result = "error");
        } else {
          try {
            syncToZen(pending, accounts, token, write, tag, redo, sys, waiting);
            pending.forEach((m) => delete retries[m.id]);
            for (const r of waiting) if (!rCheckedSet.has(r.id)) rChecked.push(r.id);
          } catch (e) {
            const text2 = e instanceof Error ? e.message : String(e);
            console.error(`${tag} сбой Дзен-мани: ${text2}`);
            for (const r of waiting) {
              r.result = null;
              r.event = void 0;
            }
            if (text2.includes("401")) sys.push({ key: "zen-401", text: "Дзен-мани отвечает 401: токен ZEN_TOKEN недействителен, нужен новый." });
            for (const m of pending) {
              const n = (retries[m.id] ?? 0) + 1;
              if (n >= MAX_RETRIES) {
                m.result = "error";
                m.reason = `Дзен-мани недоступен ${MAX_RETRIES} раз подряд: ${text2.slice(0, 150)}`;
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
      rThreads.forEach((thread, i) => {
        const mine = rMsgs.filter((r) => r.thread === i);
        if (mine.some((r) => r.result === null) && !rBroken.has(i)) return;
        let worst = rBroken.has(i) ? R_RANK.indexOf("error") : -1;
        for (const r of mine) if (r.result) worst = Math.max(worst, R_RANK.indexOf(r.result));
        if (worst >= 0) thread.addLabel(label(R_LABEL[R_RANK[worst]]));
        thread.removeLabel(rInbox);
      });
      for (const r of rMsgs) if (r.result && R_FINAL.has(r.result) && !rSeenSet.has(r.id)) rSeen.push(r.id);
      props.setProperty("RECEIPT_IDS", rSeen.slice(-KEEP_IDS).join(","));
      props.setProperty("RECEIPT_CHECKED", rChecked.slice(-KEEP_CHECKED).join(","));
      props.setProperty("PROCESSED_IDS", seen.slice(-KEEP_IDS).join(","));
      props.setProperty("RETRIES", JSON.stringify(retries));
      const doneRedo = msgs.filter((m) => m.result === "done" && m.txn && redo.has(m.txn.orderNumber)).map((m) => m.txn.orderNumber);
      if (write && doneRedo.length) {
        const left = [...redo].filter((o) => !doneRedo.includes(o));
        if (left.length) props.setProperty("REDO", left.join(","));
        else props.deleteProperty("REDO");
        console.log(`${tag} REDO выполнено: ${doneRedo.join(", ")}`);
      }
      const events = [];
      for (const m of msgs) {
        if (!m.result || m.result === "done" && !m.created) continue;
        const kind = m.result === "done" ? "written" : m.result;
        events.push({ kind, msgId: m.id, line: m.line, reason: m.reason });
      }
      threads.forEach((thread, i) => {
        if (broken.has(i)) events.push({ kind: "error", msgId: thread.getId(), reason: "исключение при разборе — см. журнал" });
      });
      for (const r of rMsgs) if (r.event) events.push(r.event);
      rThreads.forEach((thread, i) => {
        if (rBroken.has(i)) events.push({ kind: "error", msgId: thread.getId(), reason: "исключение при разборе чека — см. журнал" });
      });
      const day = today();
      const txns = new Map(msgs.filter((m) => m.txn).map((m) => [m.id, m.txn]));
      const stats = addStats(JSON.parse(props.getProperty("STATS") ?? "{}"), day, events, txns);
      props.setProperty("STATS", JSON.stringify(stats));
      if (msgs.some((m) => m.result !== "quarantine")) props.setProperty("LAST_BANK_DAY", day);
      const notifyAll = (props.getProperty("TG_NOTIFY") ?? "all").trim().toLowerCase() !== "problems";
      const text = buildRunMessage(events, throttled(props, sys), notifyAll);
      if (text) tgSend(props, text);
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
    const meta = readMeta(
      zenDiff(token, { currentClientTimestamp: now, serverTimestamp: now, forceFetch: ["user", "instrument", "account", "tag"] })
    );
    console.log(`Токен работает. Пользователь ${meta.userId}, VND = ${meta.instruments.VND ?? "не найден"}.`);
    for (const [num, uuid] of Object.entries(accountsMap(props))) {
      console.log(`${maskAccount(num)} → ${uuid}: ${meta.accountIds.has(uuid) ? "счёт найден" : "НЕТ такого счёта (или он в архиве)"}`);
    }
    const { rules } = loadRules(props, meta.tagsByTitle, "[rules]");
    console.log(`Правил категорий: ${rules.length} (ошибки, если есть, — строками выше).`);
    console.log(`Режим: ${isWriteMode(props) ? "write — запись включена" : "dry-run — запись выключена"}.`);
  }
  function install() {
    Object.keys(L).forEach((k) => label(L[k]));
    Object.keys(R).forEach((k) => label(R[k]));
    uninstall();
    ScriptApp.newTrigger("run").timeBased().everyMinutes(5).create();
    ScriptApp.newTrigger("dailySummary").timeBased().atHour(21).everyDays(1).inTimezone(TZ).create();
    console.log("Метки созданы, таймеры установлены: run — каждые 5 минут, dailySummary — в 21:00 (Вьетнам).");
  }
  function uninstall() {
    for (const t of ScriptApp.getProjectTriggers()) {
      if (t.getHandlerFunction() === "run" || t.getHandlerFunction() === "dailySummary") ScriptApp.deleteTrigger(t);
    }
  }
  function dailySummary() {
    const props = PropertiesService.getScriptProperties();
    const day = today();
    const stats = JSON.parse(props.getProperty("STATS") ?? "{}");
    const waiting = {};
    for (const k of WAITING) waiting[L[k]] = label(L[k]).getThreads(0, 100).length;
    const text = buildSummary(day, stats[day], waiting, props.getProperty("LAST_BANK_DAY") ?? void 0, isWriteMode(props));
    console.log(text);
    if (!tgSend(props, text)) console.log("В Telegram не отправлено: нет TG_TOKEN / TG_CHAT_ID или ошибка (см. выше).");
  }
  function tgSetup() {
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty("TG_TOKEN");
    if (!token) {
      console.error("Не задано свойство TG_TOKEN (токен от @BotFather).");
      return;
    }
    const r = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/getUpdates`, { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) {
      console.error(`Telegram: HTTP ${r.getResponseCode()} — проверьте TG_TOKEN. ${r.getContentText().slice(0, 200)}`);
      return;
    }
    const updates = JSON.parse(r.getContentText()).result ?? [];
    const chat = updates.map((u) => u.message?.chat).filter((c) => c !== void 0).pop();
    if (!chat) {
      console.error("Боту ещё никто не писал. Откройте бота в Telegram, нажмите «Start» или отправьте любое сообщение и запустите tgSetup снова.");
      return;
    }
    props.setProperty("TG_CHAT_ID", String(chat.id));
    console.log(`TG_CHAT_ID = ${chat.id} (${chat.type}) сохранён.`);
    tgSend(props, "✅ dzen-money подключён. Сюда будут приходить записи, проблемы и сводка в 21:00.");
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
  var GRAB_KEEP = [
    "Tổng cộng",
    "Ngày | Giờ",
    "CHI TIẾT ĐƠN HÀNG",
    "Người dùng",
    "Mã đơn hàng",
    "Đặt từ",
    "Giao đến",
    "Hồ sơ",
    "HÓA ĐƠN CỦA BẠN",
    "Bạn trả bằng:",
    "Chi tiết",
    "Số lượng:",
    "Tổng tạm tính",
    "Cước phí giao hàng",
    "Phí dịch vụ",
    "Tiền gửi xe",
    "BẠN TRẢ",
    "Booking ID:",
    "Picked up on",
    "Total Paid",
    "Paid by",
    "Breakdown",
    "Fare",
    "Promo",
    "Passenger",
    "Profile",
    "Your Trip",
    "Cash",
    "₫"
  ];
  function maskGrabHtml(html) {
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
      const keep = new RegExp("(" + GRAB_KEEP.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")");
      return text.split(keep).map((chunk, i) => i % 2 ? chunk : chunk.replace(/\p{L}/gu, "x").replace(/\d/g, "0")).join("");
    }).join("");
  }
  function dumpGrabSample() {
    const thread = GmailApp.search(`from:${GRAB_SENDER} subject:"${GRAB_RECEIPT_SUBJECT}"`, 0, 1)[0];
    if (!thread) {
      console.log("Чеков Grab не найдено.");
      return;
    }
    const msgs = thread.getMessages();
    const m = msgs[msgs.length - 1];
    console.log(`Authentication-Results: ${topAuthResultsHeader(m.getRawContent()) ?? "нет заголовка"}`);
    const out = processReceiptEmail({ id: m.getId(), from: m.getFrom(), subject: m.getSubject(), html: m.getBody(), raw: m.getRawContent() });
    console.log(`Разбор: ${out.status}${out.status === "receipt" ? ` ${out.receipt.kind} ${out.receipt.dateLocal} ${out.receipt.amount}` : ` — ${out.reason}`}`);
    GmailApp.createDraft(Session.getEffectiveUser().getEmail(), "zen sample: Grab", maskGrabHtml(m.getBody()));
    console.log("Обезличенный образец сохранён в «Черновики».");
  }
  return __toCommonJS(main_exports);
})();

function run() { return ZenApp.run(); }
function checkZen() { return ZenApp.checkZen(); }
function tgSetup() { return ZenApp.tgSetup(); }
function dailySummary() { return ZenApp.dailySummary(); }
function install() { return ZenApp.install(); }
function uninstall() { return ZenApp.uninstall(); }
function dumpSample() { return ZenApp.dumpSample(); }
function dumpGrabSample() { return ZenApp.dumpGrabSample(); }

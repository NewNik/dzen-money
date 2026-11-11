// Тонкий слой Apps Script: Gmail, метки, таймер, HTTP. Вся логика — в core.
// Режим задаёт свойство скрипта MODE: по умолчанию dry-run (ничего не пишет), `write` — запись в Дзен-мани.
import { anonymizeHtml } from '../core/banks/vcb/anonymize';
import { topAuthResultsHeader } from '../core/auth';
import { decodeEntities, normalizeText } from '../core/html';
import {
  formatLog,
  GRAB_RECEIPT_SUBJECT,
  GRAB_SENDER,
  maskAccount,
  processEmail,
  processReceiptEmail,
  VCB_SENDER,
} from '../core/pipeline';
import type { ParsedBankTxn, ZenDiffRequest } from '../core/types';
import { grabEvidence, reconcile, type Evidence } from '../core/zen/evidence';
import {
  fullFetchRequest,
  missingAfterWrite,
  readFullTransactions,
  readMeta,
  readTransactions,
  writeRequest,
  ZEN_DIFF_URL,
} from '../core/zen/diff';
import { formatDecision, planMessages } from '../core/zen/plan';
import { compileRules, type CompiledRule, type Rule } from '../core/zen/rules';
import defaultRules from '../../config/rules.json';
import {
  addStats,
  buildRunMessage,
  buildSummary,
  fmtAmount,
  receiptLine,
  throttle,
  truncate,
  txnLine,
  type DayStats,
  type EventKind,
  type MsgEvent,
} from '../core/notify';

const L = {
  inbox: 'zen/inbox',
  done: 'zen/done', // записано в Дзен-мани (или уже было записано)
  dryrun: 'zen/dryrun', // готово к записи, но режим dry-run
  duplicate: 'zen/duplicate', // похоже на операцию, внесённую вручную, — не записано
  unparsed: 'zen/unparsed', // письмо или счёт не распознаны
  quarantine: 'zen/quarantine', // не прошла проверка отправителя
  error: 'zen/error',
} as const;
type Result = Exclude<keyof typeof L, 'inbox'>;
const RANK: Result[] = ['done', 'dryrun', 'duplicate', 'unparsed', 'quarantine', 'error'];
/** Итоги, после которых письмо больше не трогаем. Остальные можно разобрать повторно, вернув zen/inbox. */
const FINAL: ReadonlySet<Result> = new Set<Result>(['done', 'duplicate', 'quarantine']);

// Чеки (подтверждения): ждут свою операцию под ярлыком zen/receipt.
const R = {
  pending: 'zen/receipt',
  done: 'zen/receipt-done', // операция уточнена, уже была уточнена, совпала ручная, либо письмо не требует сверки
  dryrun: 'zen/receipt-dryrun', // совпадение найдено, но режим dry-run
  unmatched: 'zen/receipt-unmatched', // операция не появилась за WAIT_DAYS дней или кандидатов несколько
} as const;
type RResult = 'done' | 'dryrun' | 'unmatched' | 'unparsed' | 'quarantine' | 'error';
const R_RANK: RResult[] = ['done', 'dryrun', 'unmatched', 'unparsed', 'quarantine', 'error'];
const R_LABEL: Record<RResult, string> = {
  done: R.done,
  dryrun: R.dryrun,
  unmatched: R.unmatched,
  unparsed: L.unparsed,
  quarantine: L.quarantine,
  error: L.error,
};
const R_FINAL: ReadonlySet<RResult> = new Set<RResult>(['done', 'unmatched', 'quarantine']);
const WAIT_DAYS = 3; // сколько дней чек ждёт операцию
const KEEP_CHECKED = 100;

const BATCH = 30; // тредов за запуск
const KEEP_IDS = 300; // сколько id обработанных писем помнить
const MAX_RETRIES = 5; // сбоев Дзен-мани подряд, после которых письмо уходит в zen/error

const TZ = 'Asia/Ho_Chi_Minh';
const today = (): string => Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
/** Ярлыки, которые ждут действий человека (для вечерней сводки). */
const WAITING: (keyof typeof L)[] = ['duplicate', 'unparsed', 'quarantine', 'error'];

const label = (name: string): GoogleAppsScript.Gmail.GmailLabel =>
  GmailApp.getUserLabelByName(name) ?? GmailApp.createLabel(name);

/** Свойство ACCOUNTS: {"<номер счёта VCB>": "<UUID счёта в Дзен-мани>"}. В номере важны только цифры. */
function accountsMap(props: GoogleAppsScript.Properties.Properties): Record<string, string> {
  const raw = props.getProperty('ACCOUNTS');
  const out: Record<string, string> = {};
  if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) out[k.replace(/\D/g, '')] = v;
  return out;
}

/** Правила категорий: личные из свойства RULES (проверяются первыми), затем встроенные из config/rules.json. */
function loadRules(
  props: GoogleAppsScript.Properties.Properties,
  tagsByTitle: Record<string, string>,
  tag: string,
): { rules: CompiledRule[]; errors: string[] } {
  let own: Rule[] = [];
  const bad: string[] = [];
  const raw = props.getProperty('RULES');
  if (raw) {
    try {
      const v = JSON.parse(raw) as unknown;
      if (Array.isArray(v)) own = v as Rule[];
      else bad.push('RULES: ожидался массив [...]');
    } catch (e) {
      bad.push(`RULES: неверный JSON — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const { rules, errors } = compileRules([...own, ...(defaultRules as Rule[])], tagsByTitle);
  const all = [...bad, ...errors];
  for (const e of all) console.error(`${tag} ${e}`);
  return { rules, errors: all };
}

// --- Telegram ---

/** Отправить сообщение. Без TG_TOKEN / TG_CHAT_ID — тихо пропустить. Сбой Telegram не ломает запуск. */
function tgSend(props: GoogleAppsScript.Properties.Properties, text: string): boolean {
  const token = props.getProperty('TG_TOKEN');
  const chat = props.getProperty('TG_CHAT_ID');
  if (!token || !chat) return false;
  try {
    const r = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: chat, text: truncate(text), disable_web_page_preview: true }),
      muteHttpExceptions: true,
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

/** Системные проблемы с антиспамом: одна и та же — не чаще раза в 6 часов. */
function throttled(props: GoogleAppsScript.Properties.Properties, items: { key: string; text: string }[]): string[] {
  let state = JSON.parse(props.getProperty('ALERTS') ?? '{}') as Record<string, number>;
  const now = Math.floor(Date.now() / 1000);
  const out: string[] = [];
  for (const it of items) {
    const r = throttle(state, it.key, now);
    state = r.state;
    if (r.send) out.push(it.text);
  }
  if (items.length) props.setProperty('ALERTS', JSON.stringify(state));
  return out;
}

const isWriteMode = (props: GoogleAppsScript.Properties.Properties): boolean =>
  (props.getProperty('MODE') ?? '').trim().toLowerCase() === 'write';

/** POST /v8/diff/. Ответ не 200 — исключение. */
function zenDiff(token: string, body: ZenDiffRequest): unknown {
  if ('deletion' in body) throw new Error('deletion в Дзен-мани не отправляем');
  const r = UrlFetchApp.fetch(ZEN_DIFF_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  const code = r.getResponseCode();
  if (code === 401) throw new Error('Дзен-мани: 401 — токен ZEN_TOKEN недействителен');
  if (code !== 200) throw new Error(`Дзен-мани: HTTP ${code} ${r.getContentText().slice(0, 200)}`);
  return JSON.parse(r.getContentText());
}

interface Msg {
  thread: number;
  id: string;
  result: Result | null;
  txn?: ParsedBankTxn;
  /** Строка операции для Telegram (txnLine, с категорией). */
  line?: string;
  reason?: string;
  /** Операция создана в этом запуске (а не «уже была»). */
  created?: boolean;
}

interface RMsg {
  thread: number;
  id: string;
  /** null — чек ещё ждёт операцию. */
  result: RResult | null;
  ev?: Evidence;
  reason?: string;
  /** Событие для Telegram, если есть о чём сообщить. */
  event?: MsgEvent;
}

/** Системная проблема для Telegram: ключ для антиспама и текст. */
type SysProblem = { key: string; text: string };

/** Проверка дублей и (в режиме write) запись. Заполняет result у писем. Сбой Дзен-мани — исключение. */
function syncToZen(
  pending: Msg[],
  accounts: Record<string, string>,
  token: string,
  write: boolean,
  tag: string,
  redo: ReadonlySet<string>,
  sys: SysProblem[],
  receipts: RMsg[],
): void {
  const now = Math.floor(Date.now() / 1000);
  // Полная выгрузка (~2,5 МБ) только когда есть что записать: нужна для проверки дублей по всем операциям.
  const full = zenDiff(token, fullFetchRequest(now));
  const meta = readMeta(full);
  const { rules, errors } = loadRules(PropertiesService.getScriptProperties(), meta.tagsByTitle, tag);
  for (const e of errors) sys.push({ key: 'rules:' + e, text: `Правила категорий: ${e}` });
  const plans = planMessages(
    pending.map((m) => ({ msgId: m.id, txn: m.txn! })),
    { accounts, userId: meta.userId, instruments: meta.instruments, now, rules },
    meta.accountIds,
    readTransactions(full),
    redo,
  );

  // Сверка с чеками: уточняет операции этого запуска и находит уже записанные.
  const creatable = plans.filter((p) => p.status === 'create');
  const rec = reconcile(
    receipts.map((r) => r.ev!),
    creatable.flatMap((p) => p.creates),
    readFullTransactions(full),
    {
      ownAccounts: new Set(Object.values(accounts)),
      instruments: meta.instruments,
      tagsByTitle: meta.tagsByTitle,
      heuristicTagIds: new Set(rules.filter((r) => r.rule.person && r.tagId).map((r) => r.tagId!)),
      now,
      today: today(),
      waitDays: WAIT_DAYS,
    },
  );
  let k = 0;
  for (const p of creatable) p.creates = rec.creates.slice(k, (k += p.creates.length));
  const tagName = (ids: string[] | null | undefined): string | undefined =>
    ids?.length ? ids.map((id) => meta.tagTitles[id] ?? id).join(', ') : undefined;
  /** Чек → id операции, от записи которой зависит его итог (в режиме write). */
  const awaiting = new Map<RMsg, string>();
  rec.outcomes.forEach((o, i) => {
    const r = receipts[i]!;
    const ev = o.ev;
    const ref = `чек ${ev.source}:${ev.id} msg=${r.id}`;
    switch (o.status) {
      case 'applied': {
        const kept = o.keptTag ? `категория оставлена: ${tagName([o.keptTag])}` : undefined;
        console.log(`${tag} ${ref}: ${o.target === 'create' ? 'уточняет новую операцию' : 'обновляет операцию'} id=${o.txn.id} tag=${tagName(o.txn.tag) ?? '-'}${kept ? ` (${kept})` : ''}`);
        const reason = [write ? undefined : 'dry-run, не изменено', kept].filter(Boolean).join('; ') || undefined;
        r.event = { kind: 'receipt', msgId: r.id, line: receiptLine(ev, tagName(o.txn.tag)), reason };
        r.result = write ? null : 'dryrun';
        if (write) awaiting.set(r, o.txn.id);
        break;
      }
      case 'already':
        console.log(`${tag} ${ref}: метка уже стоит на операции`);
        r.result = 'done';
        break;
      case 'manual':
        console.log(`${tag} ${ref}: совпала ручная операция id=${o.match.id} (${tagName(o.match.tag) ?? 'без категории'}) — не правлю`);
        r.event = { kind: 'receiptHint', msgId: r.id, line: receiptLine(ev), reason: `в учёте: ${tagName(o.match.tag) ?? 'без категории'}` };
        r.result = 'done';
        break;
      case 'ambiguous':
        console.log(`${tag} ${ref}: ${o.count} операции с суммой ${fmtAmount(ev.amount)} — не угадываю`);
        r.event = { kind: 'receiptAmbiguous', msgId: r.id, line: receiptLine(ev) };
        r.result = 'unmatched';
        break;
      case 'expired':
        console.log(`${tag} ${ref}: операция не появилась за ${WAIT_DAYS} дн.`);
        r.event = { kind: 'receiptUnmatched', msgId: r.id, line: receiptLine(ev) };
        r.result = 'unmatched';
        break;
      case 'no-tag':
        sys.push({ key: 'evidence-tag:' + ev.tagTitle, text: `Чеки: нет категории «${ev.tagTitle}» в Дзен-мани.` });
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
    const m = byId.get(p.msgId)!;
    const main = p.creates[0] ?? p.decisions[0]?.txn; // creates — после сверки с чеками
    const category = tagName(main?.tag);
    m.line = txnLine(m.txn!, category);
    m.reason = p.reason;
    m.result =
      p.status === 'done' ? 'done'
      : p.status === 'duplicate' ? 'duplicate'
      : p.status === 'unmapped' ? 'unparsed'
      : write ? null // решится после записи
      : 'dryrun';
  }

  const toCreate = creatable;
  const txns = [...toCreate.flatMap((p) => p.creates), ...rec.updates];
  if (!write || !txns.length) return;
  const resp = zenDiff(token, writeRequest(meta.serverTimestamp, txns, now));
  const missing = new Set(missingAfterWrite(resp, txns.map((t) => t.id)));
  for (const [r, id] of awaiting) {
    // Операция не подтверждена сервером — чек остаётся ждать следующего запуска.
    r.result = missing.has(id) ? null : 'done';
    if (missing.has(id)) {
      r.event = undefined;
      console.log(`${tag} чек msg=${r.id}: операция id=${id} не подтверждена сервером, повтор в следующем запуске`);
    }
  }
  for (const p of toCreate) {
    const lost = p.creates.filter((t) => missing.has(t.id));
    const m = byId.get(p.msgId)!;
    m.result = lost.length ? 'error' : 'done';
    m.created = !lost.length;
    if (lost.length) m.reason = 'Дзен-мани не подтвердил запись — см. журнал';
    console.log(`${tag} msg=${p.msgId} ${lost.length ? 'НЕ подтверждено сервером: ' + lost.map((t) => t.id).join(', ') : 'записано'}`);
  }
}

/** Запускается по таймеру. */
export function run(): void {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const inbox = label(L.inbox);
    const threads = inbox.getThreads(0, BATCH);
    const rInbox = label(R.pending);
    const rThreads = rInbox.getThreads(0, BATCH);
    if (!threads.length && !rThreads.length) return;

    const write = isWriteMode(props);
    const tag = write ? '[write]' : '[dry-run]';
    const accounts = accountsMap(props);
    const own = Object.keys(accounts);
    console.log(`${tag} свои счета (ACCOUNTS): ${own.map(maskAccount).join(', ') || 'не заданы'}`);

    // Gmail группирует письма в треды, а метки висят на треде — помним id писем с окончательным итогом.
    const seen = (props.getProperty('PROCESSED_IDS') ?? '').split(',').filter(Boolean);
    const seenSet = new Set(seen);
    const retries = JSON.parse(props.getProperty('RETRIES') ?? '{}') as Record<string, number>;
    // REDO: Order Number через запятую — записать заново, даже если письмо уже обработано, а операция удалена.
    const redo = new Set((props.getProperty('REDO') ?? '').split(/[\s,;]+/).filter(Boolean));
    if (redo.size) console.log(`${tag} REDO: ${[...redo].join(', ')}`);

    const msgs: Msg[] = [];
    const broken = new Set<number>(); // треды с исключением при разборе
    threads.forEach((thread, i) => {
      try {
        for (const m of thread.getMessages()) {
          const id = m.getId();
          if (seenSet.has(id) && !redo.size) {
            console.log(`${tag} skip msg=${id}: уже обработано`);
            continue;
          }
          const out = processEmail({ id, from: m.getFrom(), html: m.getBody(), raw: m.getRawContent() }, own);
          // При непустом REDO обработанные письма разбираются, но идут дальше только номера из REDO.
          if (seenSet.has(id) && !(out.status === 'parsed' && redo.has(out.txn.orderNumber))) {
            console.log(`${tag} skip msg=${id}: уже обработано`);
            continue;
          }
          console.log(`${tag} ${formatLog(id, out)}`);
          msgs.push(
            out.status === 'parsed'
              ? { thread: i, id, result: null, txn: out.txn, line: txnLine(out.txn) }
              : { thread: i, id, result: out.status, reason: out.reason },
          );
        }
      } catch (e) {
        console.error(`ошибка в треде ${thread.getId()}: ${e instanceof Error ? e.stack : String(e)}`);
        broken.add(i);
      }
    });

    // --- чеки под ярлыком zen/receipt ---
    const rSeen = (props.getProperty('RECEIPT_IDS') ?? '').split(',').filter(Boolean);
    const rSeenSet = new Set(rSeen);
    const rChecked = (props.getProperty('RECEIPT_CHECKED') ?? '').split(',').filter(Boolean);
    const rCheckedSet = new Set(rChecked);
    const rMsgs: RMsg[] = [];
    const rBroken = new Set<number>();
    rThreads.forEach((thread, i) => {
      try {
        for (const m of thread.getMessages()) {
          const id = m.getId();
          if (rSeenSet.has(id)) continue;
          const out = processReceiptEmail({ id, from: m.getFrom(), subject: m.getSubject(), html: m.getBody(), raw: m.getRawContent() });
          if (out.status !== 'receipt') {
            console.log(`${tag} чек msg=${id}: ${out.status} — ${out.reason}`);
            const result: RResult = out.status === 'skip' ? 'done' : out.status;
            const event: MsgEvent | undefined = out.status === 'skip' ? undefined : { kind: out.status, msgId: id, line: 'чек Grab', reason: out.reason };
            rMsgs.push({ thread: i, id, result, reason: out.reason, event });
            continue;
          }
          const ev = grabEvidence(out.receipt);
          console.log(`${tag} чек msg=${id}: ${out.receipt.service} ${out.receipt.orderId} ${out.receipt.dateLocal} ${out.receipt.amount} ${out.receipt.currency}${ev ? '' : ' — не сверяется'}`);
          rMsgs.push(ev ? { thread: i, id, result: null, ev } : { thread: i, id, result: 'done' });
        }
      } catch (e) {
        console.error(`ошибка в треде чеков ${thread.getId()}: ${e instanceof Error ? e.stack : String(e)}`);
        rBroken.add(i);
      }
    });
    const waiting = rMsgs.filter((r) => r.ev);
    // Выгрузка из Дзен-мани ради чеков — только для нового чека и для чека с истёкшим сроком;
    // в остальное время чек сверяется попутно, когда приходит письмо банка.
    const expired = (ev: Evidence): boolean => (Date.parse(today()) - Date.parse(ev.dateLocal)) / 86_400_000 >= WAIT_DAYS;
    const receiptsNeedZen = waiting.some((r) => !rCheckedSet.has(r.id) || expired(r.ev!));

    const sys: SysProblem[] = [];
    const pending = msgs.filter((m) => m.txn);
    const retryThreads = new Set<number>(); // оставить в zen/inbox до следующего запуска
    if (pending.length || receiptsNeedZen) {
      const token = props.getProperty('ZEN_TOKEN');
      if (!token) {
        console.error(`${tag} не задано свойство ZEN_TOKEN — проверить дубли и записать нельзя`);
        sys.push({ key: 'no-token', text: 'Не задано свойство ZEN_TOKEN — записать в Дзен-мани нельзя.' });
        pending.forEach((m) => (m.result = 'error'));
      } else {
        try {
          syncToZen(pending, accounts, token, write, tag, redo, sys, waiting);
          pending.forEach((m) => delete retries[m.id]);
          for (const r of waiting) if (!rCheckedSet.has(r.id)) rChecked.push(r.id);
        } catch (e) {
          const text = e instanceof Error ? e.message : String(e);
          console.error(`${tag} сбой Дзен-мани: ${text}`);
          for (const r of waiting) {
            r.result = null; // чеки подождут следующего запуска
            r.event = undefined;
          }
          if (text.includes('401')) sys.push({ key: 'zen-401', text: 'Дзен-мани отвечает 401: токен ZEN_TOKEN недействителен, нужен новый.' });
          for (const m of pending) {
            const n = (retries[m.id] ?? 0) + 1;
            if (n >= MAX_RETRIES) {
              m.result = 'error';
              m.reason = `Дзен-мани недоступен ${MAX_RETRIES} раз подряд: ${text.slice(0, 150)}`;
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
      let worst = broken.has(i) ? RANK.indexOf('error') : -1;
      for (const m of msgs) if (m.thread === i && m.result) worst = Math.max(worst, RANK.indexOf(m.result));
      if (worst >= 0) thread.addLabel(label(L[RANK[worst]!]));
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
      if (mine.some((r) => r.result === null) && !rBroken.has(i)) return; // есть чек, который ещё ждёт
      let worst = rBroken.has(i) ? R_RANK.indexOf('error') : -1;
      for (const r of mine) if (r.result) worst = Math.max(worst, R_RANK.indexOf(r.result));
      if (worst >= 0) thread.addLabel(label(R_LABEL[R_RANK[worst]!]));
      thread.removeLabel(rInbox);
    });
    for (const r of rMsgs) if (r.result && R_FINAL.has(r.result) && !rSeenSet.has(r.id)) rSeen.push(r.id);
    props.setProperty('RECEIPT_IDS', rSeen.slice(-KEEP_IDS).join(','));
    props.setProperty('RECEIPT_CHECKED', rChecked.slice(-KEEP_CHECKED).join(','));

    props.setProperty('PROCESSED_IDS', seen.slice(-KEEP_IDS).join(','));
    props.setProperty('RETRIES', JSON.stringify(retries));
    // Выполненные REDO убираем, чтобы при следующих запусках не разбирать память заново.
    const doneRedo = msgs.filter((m) => m.result === 'done' && m.txn && redo.has(m.txn.orderNumber)).map((m) => m.txn!.orderNumber);
    if (write && doneRedo.length) {
      const left = [...redo].filter((o) => !doneRedo.includes(o));
      if (left.length) props.setProperty('REDO', left.join(','));
      else props.deleteProperty('REDO');
      console.log(`${tag} REDO выполнено: ${doneRedo.join(', ')}`);
    }

    // --- статистика и Telegram ---
    const events: MsgEvent[] = [];
    for (const m of msgs) {
      if (!m.result || (m.result === 'done' && !m.created)) continue; // «уже было записано» — не событие
      const kind: EventKind = m.result === 'done' ? 'written' : m.result;
      events.push({ kind, msgId: m.id, line: m.line, reason: m.reason });
    }
    threads.forEach((thread, i) => {
      if (broken.has(i)) events.push({ kind: 'error', msgId: thread.getId(), reason: 'исключение при разборе — см. журнал' });
    });
    for (const r of rMsgs) if (r.event) events.push(r.event);
    rThreads.forEach((thread, i) => {
      if (rBroken.has(i)) events.push({ kind: 'error', msgId: thread.getId(), reason: 'исключение при разборе чека — см. журнал' });
    });
    const day = today();
    const txns = new Map(msgs.filter((m) => m.txn).map((m) => [m.id, m.txn!]));
    const stats = addStats(JSON.parse(props.getProperty('STATS') ?? '{}') as Record<string, DayStats>, day, events, txns);
    props.setProperty('STATS', JSON.stringify(stats));
    if (msgs.some((m) => m.result !== 'quarantine')) props.setProperty('LAST_BANK_DAY', day);

    const notifyAll = (props.getProperty('TG_NOTIFY') ?? 'all').trim().toLowerCase() !== 'problems';
    const text = buildRunMessage(events, throttled(props, sys), notifyAll);
    if (text) tgSend(props, text);
  } finally {
    lock.releaseLock();
  }
}

/** Запустить вручную: проверяет токен и что счета из ACCOUNTS есть в Дзен-мани. Ничего не пишет. */
export function checkZen(): void {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('ZEN_TOKEN');
  if (!token) {
    console.error('Не задано свойство ZEN_TOKEN.');
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const meta = readMeta(
    zenDiff(token, { currentClientTimestamp: now, serverTimestamp: now, forceFetch: ['user', 'instrument', 'account', 'tag'] }),
  );
  console.log(`Токен работает. Пользователь ${meta.userId}, VND = ${meta.instruments.VND ?? 'не найден'}.`);
  for (const [num, uuid] of Object.entries(accountsMap(props))) {
    console.log(`${maskAccount(num)} → ${uuid}: ${meta.accountIds.has(uuid) ? 'счёт найден' : 'НЕТ такого счёта (или он в архиве)'}`);
  }
  const { rules } = loadRules(props, meta.tagsByTitle, '[rules]');
  console.log(`Правил категорий: ${rules.length} (ошибки, если есть, — строками выше).`);
  console.log(`Режим: ${isWriteMode(props) ? 'write — запись включена' : 'dry-run — запись выключена'}.`);
}

/** Запустить один раз вручную: создаёт метки и таймер на каждые 5 минут. */
export function install(): void {
  (Object.keys(L) as (keyof typeof L)[]).forEach((k) => label(L[k]));
  (Object.keys(R) as (keyof typeof R)[]).forEach((k) => label(R[k]));
  uninstall();
  ScriptApp.newTrigger('run').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('dailySummary').timeBased().atHour(21).everyDays(1).inTimezone(TZ).create();
  console.log('Метки созданы, таймеры установлены: run — каждые 5 минут, dailySummary — в 21:00 (Вьетнам).');
}

/** Удаляет таймеры. */
export function uninstall(): void {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === 'run' || t.getHandlerFunction() === 'dailySummary') ScriptApp.deleteTrigger(t);
  }
}

/** Вечерняя сводка в Telegram (таймер в 21:00). Можно запустить вручную. */
export function dailySummary(): void {
  const props = PropertiesService.getScriptProperties();
  const day = today();
  const stats = JSON.parse(props.getProperty('STATS') ?? '{}') as Record<string, DayStats>;
  const waiting: Record<string, number> = {};
  for (const k of WAITING) waiting[L[k]] = label(L[k]).getThreads(0, 100).length;
  const text = buildSummary(day, stats[day], waiting, props.getProperty('LAST_BANK_DAY') ?? undefined, isWriteMode(props));
  console.log(text);
  if (!tgSend(props, text)) console.log('В Telegram не отправлено: нет TG_TOKEN / TG_CHAT_ID или ошибка (см. выше).');
}

/**
 * Настройка Telegram: после TG_TOKEN написать боту любое сообщение и запустить эту функцию.
 * Находит чат по последнему сообщению боту и сохраняет TG_CHAT_ID.
 */
export function tgSetup(): void {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TG_TOKEN');
  if (!token) {
    console.error('Не задано свойство TG_TOKEN (токен от @BotFather).');
    return;
  }
  const r = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/getUpdates`, { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) {
    console.error(`Telegram: HTTP ${r.getResponseCode()} — проверьте TG_TOKEN. ${r.getContentText().slice(0, 200)}`);
    return;
  }
  const updates = (JSON.parse(r.getContentText()) as { result?: { message?: { chat?: { id: number; type: string } } }[] }).result ?? [];
  const chat = updates.map((u) => u.message?.chat).filter((c) => c !== undefined).pop();
  if (!chat) {
    console.error('Боту ещё никто не писал. Откройте бота в Telegram, нажмите «Start» или отправьте любое сообщение и запустите tgSetup снова.');
    return;
  }
  props.setProperty('TG_CHAT_ID', String(chat.id));
  console.log(`TG_CHAT_ID = ${chat.id} (${chat.type}) сохранён.`);
  tgSend(props, '✅ dzen-money подключён. Сюда будут приходить записи, проблемы и сводка в 21:00.');
}

/**
 * Кладёт в «Черновики» обезличенный HTML последнего письма банка — как основу для фикстуры.
 * Перед тем как куда-либо отправлять, просмотреть: не осталось ли имён и номеров.
 */
export function dumpSample(): void {
  const thread = GmailApp.search('from:' + VCB_SENDER, 0, 1)[0];
  if (!thread) {
    console.log('Писем от банка не найдено.');
    return;
  }
  const msgs = thread.getMessages();
  const m = msgs[msgs.length - 1]!;
  const me = Session.getEffectiveUser().getEmail();
  GmailApp.createDraft(me, 'zen sample: ' + m.getSubject(), anonymizeHtml(m.getBody()));
  console.log('Обезличенный образец сохранён в «Черновики».');
}

// Подписи чека Grab, которые остаются в обезличенном образце; весь остальной текст затирается.
const GRAB_KEEP = [
  'Tổng cộng', 'Ngày | Giờ', 'CHI TIẾT ĐƠN HÀNG', 'Người dùng', 'Mã đơn hàng', 'Đặt từ', 'Giao đến', 'Hồ sơ',
  'HÓA ĐƠN CỦA BẠN', 'Bạn trả bằng:', 'Chi tiết', 'Số lượng:', 'Tổng tạm tính', 'Cước phí giao hàng', 'Phí dịch vụ',
  'Tiền gửi xe', 'BẠN TRẢ', 'Booking ID:', 'Picked up on', 'Total Paid', 'Paid by', 'Breakdown', 'Fare', 'Promo',
  'Passenger', 'Profile', 'Your Trip', 'Cash', '₫',
];

/** Текст вне тегов: подписи из GRAB_KEEP остаются, остальные буквы → x, цифры → 0. */
function maskGrabHtml(html: string): string {
  let skip = false;
  return html
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith('<')) {
        if (/^<(style|script)\b/i.test(part)) skip = true;
        if (/^<\/(style|script)/i.test(part)) skip = false;
        return part.replace(/\b(href|src|alt|title)\s*=\s*("[^"]*"|'[^']*')/gi, '$1="#"');
      }
      if (skip) return part;
      const text = normalizeText(decodeEntities(part));
      if (!text) return part;
      const keep = new RegExp('(' + GRAB_KEEP.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')');
      return text
        .split(keep)
        .map((chunk, i) => (i % 2 ? chunk : chunk.replace(/\p{L}/gu, 'x').replace(/\d/g, '0')))
        .join('');
    })
    .join('');
}

/**
 * Кладёт в «Черновики» обезличенный HTML последнего чека Grab и пишет в журнал заголовок Authentication-Results.
 * Перед тем как куда-либо отправлять, просмотреть: не осталось ли имён и адресов.
 */
export function dumpGrabSample(): void {
  const thread = GmailApp.search(`from:${GRAB_SENDER} subject:"${GRAB_RECEIPT_SUBJECT}"`, 0, 1)[0];
  if (!thread) {
    console.log('Чеков Grab не найдено.');
    return;
  }
  const msgs = thread.getMessages();
  const m = msgs[msgs.length - 1]!;
  console.log(`Authentication-Results: ${topAuthResultsHeader(m.getRawContent()) ?? 'нет заголовка'}`);
  const out = processReceiptEmail({ id: m.getId(), from: m.getFrom(), subject: m.getSubject(), html: m.getBody(), raw: m.getRawContent() });
  console.log(`Разбор: ${out.status}${out.status === 'receipt' ? ` ${out.receipt.kind} ${out.receipt.dateLocal} ${out.receipt.amount}` : ` — ${out.reason}`}`);
  GmailApp.createDraft(Session.getEffectiveUser().getEmail(), 'zen sample: Grab', maskGrabHtml(m.getBody()));
  console.log('Обезличенный образец сохранён в «Черновики».');
}

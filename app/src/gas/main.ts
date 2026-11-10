// Тонкий слой Apps Script: Gmail, метки, таймер, HTTP. Вся логика — в core.
// Режим задаёт свойство скрипта MODE: по умолчанию dry-run (ничего не пишет), `write` — запись в Дзен-мани.
import { anonymizeHtml } from '../core/banks/vcb/anonymize';
import { formatLog, maskAccount, processEmail, VCB_SENDER } from '../core/pipeline';
import type { ParsedBankTxn, ZenDiffRequest } from '../core/types';
import {
  fullFetchRequest,
  missingAfterWrite,
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

  const byId = new Map(pending.map((m) => [m.id, m]));
  for (const p of plans) {
    for (const d of p.decisions) console.log(`${tag} msg=${p.msgId} ${formatDecision(d, meta.tagTitles)}`);
    if (p.reason) console.log(`${tag} msg=${p.msgId} ${p.status}: ${p.reason}`);
    const m = byId.get(p.msgId)!;
    const main = p.decisions[0]?.txn;
    const category = main?.tag?.length ? main.tag.map((id) => meta.tagTitles[id] ?? id).join(', ') : undefined;
    m.line = txnLine(m.txn!, category);
    m.reason = p.reason;
    m.result =
      p.status === 'done' ? 'done'
      : p.status === 'duplicate' ? 'duplicate'
      : p.status === 'unmapped' ? 'unparsed'
      : write ? null // решится после записи
      : 'dryrun';
  }

  const toCreate = plans.filter((p) => p.status === 'create');
  if (!write || !toCreate.length) return;
  const txns = toCreate.flatMap((p) => p.creates);
  const resp = zenDiff(token, writeRequest(meta.serverTimestamp, txns, now));
  const missing = new Set(missingAfterWrite(resp, txns.map((t) => t.id)));
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
    if (!threads.length) return;

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

    const sys: SysProblem[] = [];
    const pending = msgs.filter((m) => m.txn);
    const retryThreads = new Set<number>(); // оставить в zen/inbox до следующего запуска
    if (pending.length) {
      const token = props.getProperty('ZEN_TOKEN');
      if (!token) {
        console.error(`${tag} не задано свойство ZEN_TOKEN — проверить дубли и записать нельзя`);
        sys.push({ key: 'no-token', text: 'Не задано свойство ZEN_TOKEN — записать в Дзен-мани нельзя.' });
        pending.forEach((m) => (m.result = 'error'));
      } else {
        try {
          syncToZen(pending, accounts, token, write, tag, redo, sys);
          pending.forEach((m) => delete retries[m.id]);
        } catch (e) {
          const text = e instanceof Error ? e.message : String(e);
          console.error(`${tag} сбой Дзен-мани: ${text}`);
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

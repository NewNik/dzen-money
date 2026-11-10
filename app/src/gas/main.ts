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

const label = (name: string): GoogleAppsScript.Gmail.GmailLabel =>
  GmailApp.getUserLabelByName(name) ?? GmailApp.createLabel(name);

/** Свойство ACCOUNTS: {"<номер счёта VCB>": "<UUID счёта в Дзен-мани>"}. В номере важны только цифры. */
function accountsMap(props: GoogleAppsScript.Properties.Properties): Record<string, string> {
  const raw = props.getProperty('ACCOUNTS');
  const out: Record<string, string> = {};
  if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) out[k.replace(/\D/g, '')] = v;
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
}

/** Проверка дублей и (в режиме write) запись. Заполняет result у писем. Сбой Дзен-мани — исключение. */
function syncToZen(pending: Msg[], accounts: Record<string, string>, token: string, write: boolean, tag: string): void {
  const now = Math.floor(Date.now() / 1000);
  // Полная выгрузка (~2,5 МБ) только когда есть что записать: нужна для проверки дублей по всем операциям.
  const full = zenDiff(token, fullFetchRequest(now));
  const meta = readMeta(full);
  const plans = planMessages(
    pending.map((m) => ({ msgId: m.id, txn: m.txn! })),
    { accounts, userId: meta.userId, instruments: meta.instruments, now },
    meta.accountIds,
    readTransactions(full),
  );

  const byId = new Map(pending.map((m) => [m.id, m]));
  for (const p of plans) {
    for (const d of p.decisions) console.log(`${tag} msg=${p.msgId} ${formatDecision(d)}`);
    if (p.reason) console.log(`${tag} msg=${p.msgId} ${p.status}: ${p.reason}`);
    const m = byId.get(p.msgId)!;
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
    byId.get(p.msgId)!.result = lost.length ? 'error' : 'done';
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

    const msgs: Msg[] = [];
    const broken = new Set<number>(); // треды с исключением при разборе
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
          msgs.push(out.status === 'parsed' ? { thread: i, id, result: null, txn: out.txn } : { thread: i, id, result: out.status });
        }
      } catch (e) {
        console.error(`ошибка в треде ${thread.getId()}: ${e instanceof Error ? e.stack : String(e)}`);
        broken.add(i);
      }
    });

    const pending = msgs.filter((m) => m.txn);
    const retryThreads = new Set<number>(); // оставить в zen/inbox до следующего запуска
    if (pending.length) {
      const token = props.getProperty('ZEN_TOKEN');
      if (!token) {
        console.error(`${tag} не задано свойство ZEN_TOKEN — проверить дубли и записать нельзя`);
        pending.forEach((m) => (m.result = 'error'));
      } else {
        try {
          syncToZen(pending, accounts, token, write, tag);
          pending.forEach((m) => delete retries[m.id]);
        } catch (e) {
          console.error(`${tag} сбой Дзен-мани: ${e instanceof Error ? e.message : String(e)}`);
          for (const m of pending) {
            const n = (retries[m.id] ?? 0) + 1;
            if (n >= MAX_RETRIES) {
              m.result = 'error';
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
  const meta = readMeta(zenDiff(token, { currentClientTimestamp: now, serverTimestamp: now, forceFetch: ['user', 'instrument', 'account'] }));
  console.log(`Токен работает. Пользователь ${meta.userId}, VND = ${meta.instruments.VND ?? 'не найден'}.`);
  for (const [num, uuid] of Object.entries(accountsMap(props))) {
    console.log(`${maskAccount(num)} → ${uuid}: ${meta.accountIds.has(uuid) ? 'счёт найден' : 'НЕТ такого счёта (или он в архиве)'}`);
  }
  console.log(`Режим: ${isWriteMode(props) ? 'write — запись включена' : 'dry-run — запись выключена'}.`);
}

/** Запустить один раз вручную: создаёт метки и таймер на каждые 5 минут. */
export function install(): void {
  (Object.keys(L) as (keyof typeof L)[]).forEach((k) => label(L[k]));
  uninstall();
  ScriptApp.newTrigger('run').timeBased().everyMinutes(5).create();
  console.log('Метки созданы, таймер установлен (каждые 5 минут).');
}

/** Удаляет таймер. */
export function uninstall(): void {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === 'run') ScriptApp.deleteTrigger(t);
  }
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

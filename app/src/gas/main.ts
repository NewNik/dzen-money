// Тонкий слой Apps Script: Gmail, свойства скрипта, сеть. Вся логика — в core.
import rulesJson from '../../config/category-rules.json';
import { processBatch, type EmailResult, type RawEmail } from '../core/run';
import { maskDigits } from '../core/text';
import { parseResponse, readRequest, serialize, writeRequest, ZEN_DIFF_URL } from '../core/zen/client';
import { buildContext } from '../core/zen/mapper';
import type { AccountsConfig, CategoryRules, LocalRule, ZenDiffRequest, ZenDiffResponse } from '../core/types';

const SENDER = 'VCBDigibank@info.vietcombank.com.vn';
const LABELS = { done: 'zen/done', unparsed: 'zen/unparsed', error: 'zen/error' };
const MAX_REMEMBERED = 400; // id сообщений в одном свойстве, лимит свойства 9 КБ
const MAX_FAILS = 5;

function prop(name: string): string | null {
  return PropertiesService.getScriptProperties().getProperty(name);
}

function jsonProp<T>(name: string, fallback: T): T {
  const raw = prop(name);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`свойство ${name}: некорректный JSON`);
  }
}

function setJsonProp(name: string, value: unknown): void {
  PropertiesService.getScriptProperties().setProperty(name, JSON.stringify(value));
}

function zenDiff(req: ZenDiffRequest): ZenDiffResponse {
  const token = prop('ZEN_TOKEN');
  if (!token) throw new Error('не задано свойство ZEN_TOKEN');
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = UrlFetchApp.fetch(ZEN_DIFF_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: `Bearer ${token}` },
      payload: serialize(req),
      muteHttpExceptions: true,
    });
    const status = res.getResponseCode();
    if (status === 429 || status >= 500) {
      lastError = `HTTP ${status}`;
      Utilities.sleep(2000 * (attempt + 1));
      continue;
    }
    return parseResponse(status, res.getContentText());
  }
  throw new Error(`Дзен-мани недоступен: ${lastError}`);
}

function notify(text: string): void {
  console.log(text);
  const token = prop('TELEGRAM_TOKEN');
  const chat = prop('TELEGRAM_CHAT_ID');
  if (!token || !chat) return;
  try {
    UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: chat, text: text.slice(0, 3900) }),
      muteHttpExceptions: true,
    });
  } catch (err) {
    console.log(`Telegram: ${String(err)}`);
  }
}

function label(name: string): GoogleAppsScript.Gmail.GmailLabel {
  return GmailApp.getUserLabelByName(name) ?? GmailApp.createLabel(name);
}

/** Основной запуск по таймеру. */
export function run(): void {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    runLocked();
  } catch (err) {
    notify(`dzen-money: ошибка запуска — ${maskDigits(String(err))}`);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function runLocked(): void {
  const dryRun = prop('DRY_RUN') !== 'false'; // по умолчанию только пробный режим
  const lookback = Number(prop('LOOKBACK_DAYS') ?? '5');
  const doneKey = dryRun ? 'PROCESSED_DRY' : 'PROCESSED';
  const done = jsonProp<string[]>(doneKey, []);
  const doneSet = new Set(done);
  const fails = jsonProp<Record<string, number>>('FAILS', {});

  const threads = GmailApp.search(`from:${SENDER} newer_than:${lookback}d`, 0, 100);
  const emails: RawEmail[] = [];
  const threadOf = new Map<string, GoogleAppsScript.Gmail.GmailThread>();
  for (const thread of threads) {
    // Gmail склеивает письма одного дня в цепочку — обрабатываем по сообщениям.
    for (const m of thread.getMessages()) {
      const id = m.getId();
      if (doneSet.has(id) || (fails[id] ?? 0) >= MAX_FAILS) continue;
      emails.push({ id, from: m.getFrom(), authResults: m.getHeader('Authentication-Results') ?? '', html: m.getBody() });
      threadOf.set(id, thread);
    }
  }
  if (emails.length === 0) return;

  const accounts = jsonProp<AccountsConfig>('ACCOUNTS', { accounts: {} });
  const local = jsonProp<LocalRule[]>('CATEGORY_RULES_LOCAL', []);
  const now = Math.floor(Date.now() / 1000);
  const ctx = buildContext(zenDiff(readRequest(now, lookback + 5)));
  const results = processBatch({ emails, ctx, accounts, rules: rulesJson as CategoryRules, local, now });

  const toCreate = results.flatMap((r) => r.transactions);
  if (!dryRun && toCreate.length > 0) {
    zenDiff(writeRequest(now, toCreate));
    // Проверка: операции должны вернуться при повторном чтении.
    const after = zenDiff(readRequest(Math.floor(Date.now() / 1000), 1));
    const ids = new Set((after.transaction ?? []).map((t) => t.id));
    const missing = toCreate.filter((t) => !ids.has(t.id)).length;
    if (missing > 0) throw new Error(`после записи не найдено операций: ${missing}`);
  }

  for (const r of results) finish(r, threadOf.get(r.id), dryRun, done, fails);
  setJsonProp(doneKey, done.slice(-MAX_REMEMBERED));
  setJsonProp('FAILS', fails);
  report(results, dryRun);
}

function finish(
  r: EmailResult, thread: GoogleAppsScript.Gmail.GmailThread | undefined, dryRun: boolean,
  done: string[], fails: Record<string, number>,
): void {
  if (r.status === 'error' || r.status === 'unparsed') {
    fails[r.id] = (fails[r.id] ?? 0) + 1;
    if (!dryRun && thread) thread.addLabel(label(r.status === 'error' ? LABELS.error : LABELS.unparsed));
    return;
  }
  delete fails[r.id];
  done.push(r.id);
  if (!dryRun && thread) thread.addLabel(label(LABELS.done));
}

function report(results: EmailResult[], dryRun: boolean): void {
  const count = (s: string) => results.filter((r) => r.status === s).length;
  const lines = results.filter((r) => r.status !== 'already' && r.status !== 'duplicate').map((r) => `${mark(r.status)} ${r.line}`);
  const head = `${dryRun ? '[пробный режим] ' : ''}dzen-money: писем ${results.length}, ` +
    `новых операций ${count('create')}, уже есть ${count('already') + count('duplicate')}, ` +
    `похожих ${count('duplicate_fuzzy')}, не разобрано ${count('unparsed')}, ошибок ${count('error')}`;
  const text = [head, ...lines].join('\n');
  const important = results.some((r) => r.status === 'error' || r.status === 'unparsed' || r.status === 'duplicate_fuzzy');
  if (important || count('create') > 0) notify(text);
  else console.log(text);
}

function mark(status: string): string {
  return status === 'create' ? '+' : status === 'duplicate_fuzzy' ? '≈' : '!';
}

/** Однократная настройка: ярлыки и таймер на каждые 10 минут. */
export function setup(): void {
  for (const name of Object.values(LABELS)) label(name);
  for (const t of ScriptApp.getProjectTriggers()) if (t.getHandlerFunction() === 'run') ScriptApp.deleteTrigger(t);
  ScriptApp.newTrigger('run').timeBased().everyMinutes(10).create();
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('DRY_RUN') === null) p.setProperty('DRY_RUN', 'true');
  console.log('Готово: ярлыки созданы, таймер установлен, DRY_RUN=' + p.getProperty('DRY_RUN'));
}

/** Проверка токена и конфига без записи: печатает счета и число категорий. */
export function check(): void {
  const now = Math.floor(Date.now() / 1000);
  const ctx = buildContext(zenDiff(readRequest(now, 1)));
  const accounts = jsonProp<AccountsConfig>('ACCOUNTS', { accounts: {} });
  const known = new Set(ctx.accounts.map((a) => a.id));
  const entries = Object.entries(accounts.accounts);
  console.log(`Дзен-мани: счетов ${ctx.accounts.length}, категорий ${ctx.tags.length}`);
  console.log(`ACCOUNTS: счетов ${entries.length}`);
  for (const [num, id] of entries) {
    const title = ctx.accounts.find((a) => a.id === id)?.title ?? 'НЕ НАЙДЕН';
    console.log(`  ****${num.slice(-4)} → ${known.has(id) ? title : 'НЕ НАЙДЕН'}`);
  }
  console.log('Счета в Дзен-мани (для ACCOUNTS):');
  for (const a of ctx.accounts) console.log(`  ${a.title.trim()} = ${a.id}`);
}

// Тонкий слой Apps Script: Gmail, метки, таймер. Вся логика — в core.
// Этап 2: только чтение и лог (dry-run). Запись в Дзен-мани появится на этапе 3.
import { anonymizeHtml } from '../core/banks/vcb/anonymize';
import { formatLog, maskAccount, processEmail, VCB_SENDER } from '../core/pipeline';

const L = {
  inbox: 'zen/inbox',
  dryrun: 'zen/dryrun', // разобрано, но не записано (dry-run)
  unparsed: 'zen/unparsed',
  quarantine: 'zen/quarantine',
  error: 'zen/error',
} as const;
type Result = Exclude<keyof typeof L, 'inbox'>;
const RANK: Result[] = ['dryrun', 'unparsed', 'quarantine', 'error'];

const BATCH = 30; // тредов за запуск
const KEEP_IDS = 300; // сколько id обработанных писем помнить

const label = (name: string): GoogleAppsScript.Gmail.GmailLabel =>
  GmailApp.getUserLabelByName(name) ?? GmailApp.createLabel(name);

/** Номера своих счётов из свойства ACCOUNTS: {"<номер счёта>": "<UUID счёта в Дзен-мани>"}. */
function ownAccounts(props: GoogleAppsScript.Properties.Properties): string[] {
  const raw = props.getProperty('ACCOUNTS');
  // Пробелы, точки и дефисы в номере не важны: сравниваем только цифры, как и номера из письма.
  return raw ? Object.keys(JSON.parse(raw) as Record<string, string>).map((k) => k.replace(/\D/g, '')) : [];
}

/** Запускается по таймеру. */
export function run(): void {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const own = ownAccounts(props);
    // Gmail группирует письма в треды, а метки висят на треде — помним id уже обработанных писем.
    const seen = (props.getProperty('PROCESSED_IDS') ?? '').split(',').filter(Boolean);
    const seenSet = new Set(seen);
    const inbox = label(L.inbox);

    const threads = inbox.getThreads(0, BATCH);
    if (threads.length) console.log(`[dry-run] свои счета (ACCOUNTS): ${own.map(maskAccount).join(', ') || 'не заданы'}`);
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
          console.log('[dry-run] ' + formatLog(id, out));
          const res: Result = out.status === 'parsed' ? 'dryrun' : out.status;
          worst = Math.max(worst, RANK.indexOf(res));
          // Неразобранные не запоминаем: после исправления парсера их разбирают повторно,
          // вернув ярлык zen/inbox.
          if (res === 'unparsed') continue;
          seen.push(id);
          seenSet.add(id);
        }
      } catch (e) {
        console.error(`ошибка в треде ${thread.getId()}: ${e instanceof Error ? e.stack : String(e)}`);
        worst = RANK.indexOf('error');
      }
      if (worst >= 0) thread.addLabel(label(L[RANK[worst]!]));
      thread.removeLabel(inbox);
    }
    props.setProperty('PROCESSED_IDS', seen.slice(-KEEP_IDS).join(','));
  } finally {
    lock.releaseLock();
  }
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

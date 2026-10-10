// «Тренинг навыков DBT» — первая версия без сервера.
// Содержание берётся из data.js, личные записи лежат в IndexedDB (db.js).
(() => {
"use strict";
const D = window.DBT_DATA;
const TOTAL = Object.keys(D.sessions).length; // число сессий берётся из data.js

// ---------- Утилиты ----------
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const hm = d => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const shortDate = d => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
const longDate = d => {
  try { return d.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" }) + ", " + hm(d); }
  catch (e) { return shortDate(d) + ", " + hm(d); }
};
// "2026-10-07T18:00" → локальное время телефона (без сдвига по часовому поясу)
function parseLocal(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(s || ""));
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 18), +(m[5] || 0));
}
let toastTimer;
function toast(t) {
  const el = $("#toast");
  el.textContent = t; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
const privacy = t => `<div class="privacy"><span aria-hidden="true">🔒</span><span>${t}</span></div>`;

// ---------- Расписание ----------
// Для проверки можно открыть приложение с ?date=2026-11-20 — «сегодня» станет этой датой.
const TEST_NOW = (() => {
  try { const p = new URLSearchParams(location.search).get("date"); return p ? parseLocal(p.includes("T") ? p : p + "T12:00") : null; }
  catch (e) { return null; }
})();
const now = () => TEST_NOW ? new Date(TEST_NOW) : new Date();

const dates = (() => {
  const out = [];
  let d = parseLocal(D.group.firstMeeting);
  for (let n = 1; n <= TOTAL; n++) {
    const moved = D.moves && D.moves[n] && parseLocal(D.moves[n]);
    if (moved) d = moved;
    else if (n > 1) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7, d.getHours(), d.getMinutes());
    out[n] = d;
  }
  return out;
})();
const sessDate = n => dates[n];
const isMoved = n => !!(D.moves && D.moves[n]);
// Сессия N становится текущей в момент начала её встречи
function calcCurrent() {
  const t = now(); let c = 1;
  for (let n = 1; n <= TOTAL; n++) if (t >= sessDate(n)) c = n;
  return c;
}
function nextMeeting() {
  const t = now();
  for (let n = 1; n <= TOTAL; n++) if (sessDate(n) > t) return n;
  return null;
}
const moduleOf = n => (D.modules.find(m => n >= m.from && n <= m.to) || {}).name || "";

// ---------- Состояние ----------
// diary: { "2026-10-10": запись }, grid: { "навык": [недели] }
const EMPTY = () => ({ answers: {}, practices: {}, marks: {}, diary: {}, grid: {}, chains: {}, meta: {}, drafts: { ans: {}, form: {}, diary: null } });
let S = EMPTY();
let loaded = false, storageError = null;
let CURRENT = calcCurrent();
let editAns = false;
const openSess = new Set();

const emptyForm = () => ({ sit: "", before: 3, steps: [], did: "", after: 2, res: "", note: "" });
const form = () => (S.drafts.form[CURRENT] = S.drafts.form[CURRENT] || emptyForm());
const marksOf = n => S.marks[n] || {};

// ---------- Дневник: даты и недели ----------
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayFromKey = k => parseLocal(k + "T12:00");
const todayKey = () => dayKey(now());
const yesterdayKey = () => { const t = now(); return dayKey(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1)); };
const dayLabel = k => {
  const d = dayFromKey(k);
  try { return d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" }); }
  catch (e) { return shortDate(d); }
};
// Неделя (номер сессии), к которой относится день: по концу этого дня
function weekOfDay(k) {
  const d = dayFromKey(k), end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59);
  let w = 1;
  for (let n = 1; n <= TOTAL; n++) if (end >= sessDate(n)) w = n;
  return w;
}
const DIARY_DAYS_FOR_MARK = 4;
const diaryDaysInWeek = w => Object.values(S.diary).filter(e => e.week === w).length;

const emptyDiary = day => ({ day, em: [], power: 2, sk: [], note: "" });
const diaryFromEntry = day => {
  const e = S.diary[day];
  return e ? { day, em: [...e.em], power: e.power, sk: [...e.sk], note: e.note } : emptyDiary(day);
};
// Черновик дневника — только за сегодня или вчера; устаревший начинаем заново
function diaryDraft() {
  const dr = S.drafts.diary;
  if (!dr || (dr.day !== todayKey() && dr.day !== yesterdayKey())) S.drafts.diary = diaryFromEntry(todayKey());
  return S.drafts.diary;
}

async function load() {
  try {
    const all = await DB.getAll();
    const base = EMPTY();
    S = { ...base, ...all, drafts: { ...base.drafts, ...(all.drafts || {}) } };
    loaded = true; storageError = null;
  } catch (e) {
    loaded = false; storageError = e;
  }
}

// Запись одного раздела. Пока запись не удалась, данные в памяти не трогаем,
// чтобы человек не потерял набранный текст и мог повторить.
// update получает копию текущего значения и возвращает новое.
async function commit(key, update) {
  if (!loaded) {
    // Нельзя писать поверх того, что не смогли прочитать
    const draftsInMemory = S.drafts;
    await load();
    if (!loaded) throw storageError || new Error("Хранилище недоступно");
    S.drafts = { ...S.drafts, ...draftsInMemory };
  }
  const value = update(clone(S[key] || {}));
  await DB.set(key, value);
  S[key] = value;
  storageError = null;
  DB.persist();
}
const clone = v => JSON.parse(JSON.stringify(v));

function saveFailed(e) {
  console.error(e);
  storageError = e;
  toast("Не получилось сохранить. Текст на месте, попробуйте ещё раз.");
  render();
}

// Черновики сохраняются сами, через полсекунды после набора
let draftTimer;
function saveDraftsSoon() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    if (!loaded) return;
    DB.set("drafts", S.drafts).catch(e => { console.error(e); });
  }, 500);
}

// ---------- Экраны ----------
function storageAlert() {
  if (!storageError) return "";
  return `<div class="alert" role="alert"><b>Хранилище на телефоне сейчас недоступно.</b>
    <span>Новые записи могут не сохраниться. Не закрывайте приложение, пока не сохраните. Если вы в режиме «Инкогнито», откройте приложение в обычном окне.</span>
    <button class="btn ghost" id="retry-db">Попробовать снова</button></div>`;
}

// ---------- Включение разбора цепочки ----------
// Разбор включается сам с сессии chainFrom; на этой неделе он «новый».
// chainEnabled: true в data.js включает его сразу (оставлено для совместимости).
const CHAIN_FROM = +D.chainFrom || 0;
const chainOn = () => !!D.chainEnabled || (CHAIN_FROM > 0 && CURRENT >= CHAIN_FROM);
const chainIsNew = () => chainOn() && CURRENT === CHAIN_FROM;
let chainIntro = false; // участника только что привели на экран разбора в первый раз

function chainCard() {
  if (!chainOn()) return "";
  return `<section class="card">
    <span class="eyebrow">${chainIsNew() ? `<span class="badge">Новое · с этой недели</span>` : "Каждую неделю"}</span>
    <h2>Анализ поведенческой цепочки</h2>
    <p class="muted">Выберите один случай недели, когда поступили так, как не хотели бы. Разберите его по звеньям и найдите, где можно было разорвать цепочку.</p>
    <p class="muted">На этой неделе: <b>${(S.chains[CURRENT] || []).length ? "разобрано" : "ещё нет"}</b></p>
    <button class="btn ${chainIsNew() ? "" : "ghost"}" data-go="chain">Разобрать цепочку</button>
  </section>`;
}

// Один раз после включения разбора открываем его экран. Отметка хранится в IndexedDB.
async function showChainIntroOnce() {
  if (!chainOn() || !loaded || (S.meta && S.meta.chainIntroSeen)) return;
  try { await commit("meta", m => { m.chainIntroSeen = now().toISOString(); return m; }); }
  catch (e) { console.error(e); return; } // не смогли запомнить — не показываем, чтобы не приводить сюда при каждом открытии
  chainIntro = true;
  if (route() !== "chain") location.hash = "chain";
  else render();
  setTimeout(() => toast("Новое: анализ поведенческой цепочки"), 300);
}

function viewToday() {
  const s = D.sessions[CURRENT], done = (S.practices[CURRENT] || []).length;
  const mk = marksOf(CURRENT), next = nextMeeting();
  const beforeStart = now() < sessDate(1);
  const item = (k, label, sub) => `<button class="check ${mk[k] ? "on" : ""}" data-mark="${k}" aria-pressed="${!!mk[k]}"><span class="box" aria-hidden="true">✓</span><span><b>${label}</b><br><span class="muted">${esc(sub)}</span></span></button>`;
  const ans = S.answers[CURRENT];
  const ansDraft = S.drafts.ans[CURRENT] != null ? S.drafts.ans[CURRENT] : "";
  return `${storageAlert()}
  <div class="hero">
    <span class="eyebrow">${beforeStart ? "Скоро начало · " : ""}Сессия ${CURRENT} из ${TOTAL} · ${esc(moduleOf(CURRENT))}</span>
    <h1>${esc(s.t)}</h1>
    <span class="read">${beforeStart ? "Первая встреча" : "Встреча"}: ${longDate(sessDate(CURRENT))}</span>
    ${next && next !== CURRENT ? `<span class="read">Следующая: ${longDate(sessDate(next))}${isMoved(next) ? " (перенесена)" : ""}</span>` : ""}
    ${s.read ? `<span class="read">Читаем: Ван Дейк, ${esc(s.read)}</span>` : ""}
    <div class="bar" role="progressbar" aria-label="Пройдено сессий" aria-valuemin="0" aria-valuemax="${TOTAL}" aria-valuenow="${CURRENT}"><i style="width:${CURRENT / TOTAL * 100}%"></i></div>
  </div>
  ${chainIsNew() ? chainCard() : ""}
  <section class="card">
    <span class="eyebrow">Вопрос недели</span>
    <p class="quote">${esc(s.q)}</p>
    ${ans && !editAns
      ? `<div class="entry"><span class="eyebrow">Мой ответ</span><span style="white-space:pre-wrap">${esc(ans)}</span></div>
         <button class="chip" id="edit-ans" style="align-self:flex-start">Изменить ответ</button>`
      : `<label for="ans">Мой ответ</label>
         <textarea id="ans" placeholder="Напишите пару строк. На группе можно поделиться, если захотите">${esc(ansDraft)}</textarea>
         <div class="row"><button class="btn ghost" id="save-ans">Сохранить ответ</button>${ans ? `<button class="btn ghost" id="cancel-ans" style="flex:0 0 auto">Отмена</button>` : ""}</div>`}
  </section>
  <section class="card">
    <span class="eyebrow">Задание недели</span>
    <h2>${esc(s.task.title)}</h2>
    <p class="muted">${esc(s.task.intro)}</p>
    <p class="muted">Заполнено раз: <b>${done}</b></p>
    <button class="btn ghost" data-go="practice">Заполнить практику</button>
  </section>
  ${chainIsNew() ? "" : chainCard()}
  <section class="card">
    <h2>Мои отметки за неделю</h2>
    ${item("diary", "Заполнял дневник", `хотя бы ${DIARY_DAYS_FOR_MARK} дня из 7 · сейчас ${diaryDaysInWeek(CURRENT)}`)}
    ${item("hw", "Сделал задание недели", s.task.title)}
    ${chainOn() ? item("chain", "Разобрал цепочку", "анализ поведенческой цепочки") : ""}
    ${s.read ? item("read", "Прочитал главу", `Ван Дейк, ${s.read}`) : ""}
    <p class="muted">В этой версии отметки никуда не отправляются. Покажите их ведущему на встрече.</p>
    ${privacy("Ведущий увидит только эти галочки. Ответы, практики и дневник остаются на вашем телефоне.")}
  </section>
  ${backupCard()}
  ${isLeader() ? "" : `<button class="linkbtn" id="leader-on">Я ведущий или координатор</button>`}
  ${TEST_NOW ? `<p class="muted">Проверочный режим: сегодня считается ${shortDate(TEST_NOW)} ${TEST_NOW.getFullYear()}.</p>` : ""}`;
}

function viewPractice() {
  const s = D.sessions[CURRENT], list = S.practices[CURRENT] || [], fd = form();
  const rng = (id, label, v) => `<label for="${id}">${label}: <span id="${id}-v">${v}</span> из 5</label>
    <input type="range" id="${id}" min="0" max="5" step="1" value="${v}">
    <div class="scale" aria-hidden="true"><span>0 · спокойно</span><span>5 · буря</span></div>`;
  return `<button class="chip" data-go="today" style="align-self:flex-start">← Назад</button>
  ${storageAlert()}
  <span class="eyebrow">Сессия ${CURRENT} · ${esc(moduleOf(CURRENT))}</span>
  <h1>${esc(s.task.title)}</h1>
  ${privacy("Ответы остаются на этом телефоне. Ведущий увидит только отметку, что задание сделано.")}
  <section class="card"><label for="sit">1. Что произошло?</label><textarea id="sit" placeholder="Где, с кем, что случилось">${esc(fd.sit)}</textarea></section>
  <section class="card">${rng("before", "2. Насколько сильной была эмоция", fd.before)}</section>
  <section class="card"><label>3. Что получилось сделать?</label>
    ${s.task.steps.map(([l, t, sub]) => { const on = fd.steps.includes(t); return `<button class="check ${on ? "on" : ""}" data-step="${esc(t)}" aria-pressed="${on}"><span class="box" aria-hidden="true">✓</span><span><b>${l ? `<span class="ltr">${esc(l)}</span>` : ""}${esc(t)}</b>${sub ? `<br><span class="muted">${esc(sub)}</span>` : ""}</span></button>`; }).join("")}
  </section>
  <section class="card"><label for="did">4. Что вы сделали в итоге?</label><textarea id="did" placeholder="Как поступили">${esc(fd.did)}</textarea></section>
  <section class="card">${rng("after", "5. Насколько сильной эмоция стала после", fd.after)}
    <label>6. Помог ли навык?</label>
    <div class="chips">${D.practiceResults.map(r => `<button class="chip ${fd.res === r ? "on" : ""}" data-res="${esc(r)}" aria-pressed="${fd.res === r}">${esc(r)}</button>`).join("")}</div></section>
  <section class="card"><label for="fnote">7. Что заметили? Что сделаете иначе в следующий раз?</label><textarea id="fnote">${esc(fd.note)}</textarea></section>
  <button class="btn" id="save-form">Сохранить практику</button>
  <section class="card"><h2>Мои практики этой недели</h2>${list.length ? list.map(p => `<div class="entry">
      <span class="eyebrow">${esc(shortDate(new Date(p.date)))} · было ${p.before}/5 → стало ${p.after}/5</span>
      <span style="white-space:pre-wrap">${esc(p.sit)}</span>
      <span class="muted">${esc(p.steps.join(", ") || "Шаги не отмечены")}${p.res ? ` · ${esc(p.res)}` : ""}</span>
      ${p.did ? `<span class="muted">Сделал: ${esc(p.did)}</span>` : ""}
      ${p.note ? `<span class="muted">Заметил: ${esc(p.note)}</span>` : ""}
    </div>`).join("") : `<p class="muted">Пока нет записей. Первая появится здесь после сохранения.</p>`}</section>`;
}

function viewPlan() {
  return `${storageAlert()}<h1>План тренинга</h1>
  <p class="muted">${TOTAL} ${TOTAL % 10 === 1 && TOTAL % 100 !== 11 ? "сессия" : [2, 3, 4].includes(TOTAL % 10) && ![12, 13, 14].includes(TOTAL % 100) ? "сессии" : "сессий"}, ${esc(D.group.name)}. Нажмите на сессию, чтобы увидеть чтение, вопрос и задание.</p>` +
  D.modules.map(m => {
    let rows = "";
    for (let i = m.from; i <= m.to; i++) {
      const s = D.sessions[i], st = i < CURRENT ? "past" : i === CURRENT ? "cur" : "";
      const d = sessDate(i);
      rows += `<button class="sess ${st} ${openSess.has(i) ? "open" : ""}" data-sess="${i}" aria-expanded="${openSess.has(i)}">
        <span class="n">${i < CURRENT ? "✓ " : ""}${i}</span>
        <span><span class="muted">${shortDate(d)}, ${hm(d)}</span>
          ${i === CURRENT ? ` <span class="badge now">сейчас</span>` : ""}${isMoved(i) ? ` <span class="badge">перенесена</span>` : ""}
          <br><span>${esc(s.t)}</span>
          <span class="more">
            ${s.read ? `<span><b>Читаем:</b> Ван Дейк, ${esc(s.read)}</span>` : ""}
            <span><b>Вопрос:</b> ${esc(s.q)}</span>
            <span><b>Задание:</b> ${esc(s.task.title)}</span>
            ${S.answers[i] ? `<span><b>Мой ответ:</b> ${esc(S.answers[i])}</span>` : ""}
          </span>
        </span></button>`;
    }
    return `<section class="module"><span class="eyebrow">${esc(m.name)} · ${m.from === m.to ? `сессия ${m.from}` : `сессии ${m.from}–${m.to}`}</span>${rows}</section>`;
  }).join("");
}

function viewDiary() {
  const dr = diaryDraft(), exists = !!S.diary[dr.day];
  const chips = (arr, sel, attr) => arr.map(x => `<button class="chip ${sel.includes(x) ? "on" : ""}" data-${attr}="${esc(x)}" aria-pressed="${sel.includes(x)}">${esc(x)}</button>`).join("");
  const dayChip = (k, label) => `<button class="chip ${dr.day === k ? "on" : ""}" data-dday="${k}" aria-pressed="${dr.day === k}">${label} · ${esc(dayLabel(k))}</button>`;
  const entries = Object.keys(S.diary).sort().reverse().map(k => S.diary[k]);
  const days = diaryDaysInWeek(CURRENT);
  return `${storageAlert()}<h1>Дневник</h1>
  ${privacy("Дневник хранится только на этом телефоне. Никто, включая ведущего, его не видит.")}
  <section class="card">
    <h2>Запись за день</h2>
    <div class="chips" role="group" aria-label="За какой день запись">${dayChip(todayKey(), "Сегодня")}${dayChip(yesterdayKey(), "Вчера")}</div>
    ${exists ? `<p class="muted">Запись за этот день уже есть. Её можно поправить и сохранить заново.</p>` : ""}
    <label>Какие эмоции были?</label><div class="chips">${chips(D.emotions, dr.em, "em")}</div>
    <label for="power">Самая сильная эмоция: <span id="power-v">${dr.power}</span> из 5</label>
    <input type="range" id="power" min="0" max="5" step="1" value="${dr.power}">
    <div class="scale" aria-hidden="true"><span>0 · спокойно</span><span>5 · буря</span></div>
    <label>Какие навыки применил?</label><div class="chips">${chips(D.diarySkills, dr.sk, "dsk")}</div>
    <label for="dnote">Заметка</label><textarea id="dnote" placeholder="Что произошло и что помогло">${esc(dr.note)}</textarea>
    <button class="btn" id="save-diary">${exists ? "Сохранить изменения" : "Сохранить запись"}</button>
    <p class="muted">На этой неделе дневник заполнен дней: <b>${days}</b> из 7. Навыки из записи сами отмечаются в таблице навыков.</p>
  </section>
  <section class="card"><h2>Прошлые записи</h2>${entries.length ? entries.map(e => `<div class="entry">
      <span class="eyebrow">${esc(dayLabel(e.day))} · сила ${e.power}/5</span>
      <span><b>${esc(e.em.join(", ") || "Без отметки эмоций")}</b></span>
      ${e.sk.length ? `<span class="muted">Навыки: ${esc(e.sk.join(", "))}</span>` : ""}
      ${e.note ? `<span style="white-space:pre-wrap">${esc(e.note)}</span>` : ""}
    </div>`).join("") : `<p class="muted">Пока нет записей. Первая появится здесь после сохранения.</p>`}</section>`;
}

// ---------- Анализ поведенческой цепочки ----------
const emptyChain = () => ({ beh: "", event: "", vuln: [], vnote: "", links: [{ type: D.linkTypes[0], text: "" }], shortC: "", longC: "", skills: [], snote: "", repair: "", prevent: "" });
const chainDraft = () => (S.drafts.chain = S.drafts.chain || emptyChain());
// Поля формы: id textarea → поле черновика
const CHAIN_FIELDS = { "ch-beh": "beh", "ch-event": "event", "ch-vnote": "vnote", "ch-short": "shortC", "ch-long": "longC", "ch-snote": "snote", "ch-repair": "repair", "ch-prevent": "prevent" };

function chainPicture(c) {
  const L = (cls, lbl, t) => t ? `<div class="link ${cls}"><small>${lbl}</small>${esc(t)}</div>` : "";
  return `<div class="chain">
    ${L("vuln", "Уязвимость", [...c.vuln, c.vnote.trim()].filter(Boolean).join(", "))}
    ${L("", "Событие", c.event.trim())}
    ${c.links.filter(l => l.text.trim()).map(l => L("", esc(l.type), l.text.trim())).join("")}
    ${L("beh", "Поведение", c.beh.trim())}
    ${L("vuln", "Последствия", [c.shortC.trim() && "сразу: " + c.shortC.trim(), c.longC.trim() && "потом: " + c.longC.trim()].filter(Boolean).join(" · "))}
  </div>`;
}
const chainHasContent = c => !!(c.beh.trim() || c.event.trim() || c.vuln.length || c.vnote.trim() || c.links.some(l => l.text.trim()) || c.shortC.trim() || c.longC.trim());
function updateChainPreview() {
  const box = $("#chain-preview");
  if (!box) return;
  const c = chainDraft();
  box.hidden = !chainHasContent(c);
  box.querySelector(".chain-body").innerHTML = chainPicture(c);
}

function viewChain() {
  const cd = chainDraft();
  const ta = (id, label, ph) => `<section class="card"><label for="${id}">${label}</label><textarea id="${id}" placeholder="${ph}">${esc(cd[CHAIN_FIELDS[id]])}</textarea></section>`;
  const chips = (arr, sel, attr) => arr.map(x => `<button class="chip ${sel.includes(x) ? "on" : ""}" data-${attr}="${esc(x)}" aria-pressed="${sel.includes(x)}">${esc(x)}</button>`).join("");
  // Навыки, которые группа уже прошла
  const skillNames = GRID_ROWS.filter(r => r.s <= CURRENT).map(r => r.n);
  const weeks = Object.keys(S.chains).map(Number).sort((a, b) => b - a);
  return `<button class="chip" data-go="today" style="align-self:flex-start">← Назад</button>
  ${storageAlert()}
  <span class="eyebrow">Неделя ${CURRENT}</span>
  <h1>Анализ поведенческой цепочки</h1>
  ${chainIntro ? `<div class="alert" role="status" style="color:var(--ink);background:var(--done-soft)">
    <b>Новое: анализ поведенческой цепочки</b>
    <span>${chainIsNew() ? "С этой недели раз" : "Раз"} в неделю выбирайте один случай, когда поступили так, как не хотели бы, и разбирайте его по шагам ниже. Карточка разбора теперь есть на экране «Сегодня».</span>
  </div>` : ""}
  ${privacy("Разбор остаётся только на этом телефоне. Ведущий увидит лишь отметку, что вы его сделали. Подробно обсудить можно с ведущим лично.")}
  ${ta("ch-beh", "1. Что я сделал и хочу изменить?", "Опишите конкретно, как на видео: что вы сделали или сказали")}
  ${ta("ch-event", "2. Что запустило цепочку?", "Событие снаружи: что произошло прямо перед этим")}
  <section class="card"><label>3. Что сделало меня уязвимее?</label>
    <div class="chips">${chips(D.vulnerabilities, cd.vuln, "vuln")}</div>
    <textarea id="ch-vnote" placeholder="Что-то ещё">${esc(cd.vnote)}</textarea></section>
  <section class="card"><label>4. Звенья цепочки</label>
    <p class="muted">Шаг за шагом от события до поведения: мысли, чувства, ощущения в теле, действия.</p>
    ${cd.links.map((l, i) => `<div class="lrow"><span class="lnum">Звено ${i + 1}</span>
      <div class="chips" role="group" aria-label="Тип звена ${i + 1}">${D.linkTypes.map(t => `<button class="chip ${l.type === t ? "on" : ""}" data-ltype="${i}|${esc(t)}" aria-pressed="${l.type === t}">${esc(t)}</button>`).join("")}</div>
      <textarea data-ltext="${i}" rows="2" aria-label="Звено ${i + 1}" placeholder="Что было на этом шаге">${esc(l.text)}</textarea>
      ${cd.links.length > 1 ? `<button class="chip" data-lrm="${i}" style="align-self:flex-start">Убрать звено</button>` : ""}</div>`).join("")}
    <button class="btn ghost" id="add-link">Добавить звено</button></section>
  <section class="card"><label for="ch-short">5. Последствия</label>
    <textarea id="ch-short" placeholder="Сразу: что я получил или почувствовал">${esc(cd.shortC)}</textarea>
    <textarea id="ch-long" aria-label="Последствия потом" placeholder="Потом: для меня и для других">${esc(cd.longC)}</textarea></section>
  <section class="card"><label>6. Где можно было разорвать цепочку и каким навыком?</label>
    <div class="chips">${chips(skillNames, cd.skills, "chsk")}</div>
    <textarea id="ch-snote" placeholder="На каком звене и что можно было сделать иначе">${esc(cd.snote)}</textarea></section>
  ${ta("ch-repair", "7. Как исправить последствия?", "Что я сделаю, чтобы исправить вред")}
  ${ta("ch-prevent", "8. Как предотвратить в следующий раз?", "Как снизить уязвимость или подготовиться к такой ситуации")}
  <section class="card" id="chain-preview" ${chainHasContent(cd) ? "" : "hidden"}><h2>Ваша цепочка сейчас</h2><div class="chain-body">${chainPicture(cd)}</div></section>
  <button class="btn" id="save-chain">Сохранить разбор</button>
  <section class="card"><h2>Мои разборы</h2>${weeks.length ? weeks.flatMap(w => (S.chains[w] || []).map(c => `<div class="entry">
      <span class="eyebrow">Неделя ${w} · ${esc(shortDate(new Date(c.date)))}</span>
      ${chainPicture(c)}
      ${c.skills.length ? `<span class="muted">Можно было: ${esc(c.skills.join(", "))}</span>` : ""}
      ${c.snote ? `<span class="muted">${esc(c.snote)}</span>` : ""}
      ${c.repair ? `<span class="muted">Исправить: ${esc(c.repair)}</span>` : ""}
      ${c.prevent ? `<span class="muted">В следующий раз: ${esc(c.prevent)}</span>` : ""}
    </div>`)).join("") : `<p class="muted">Пока нет разборов.</p>`}</section>`;
}

// ---------- Копия записей ----------
// Личные разделы, которые попадают в копию. Черновики не берём: это недописанное.
const BACKUP_KEYS = ["answers", "practices", "marks", "diary", "grid", "chains"];
const BACKUP_APP = "dbt-training";

function backupCard() {
  const last = S.meta && S.meta.lastBackup ? new Date(S.meta.lastBackup) : null;
  const days = last ? Math.floor((now() - last) / 864e5) : null;
  const hasData = BACKUP_KEYS.some(k => S[k] && Object.keys(S[k]).length);
  const stale = hasData && (days === null || days >= 14);
  return `<section class="card">
    <h2>Копия записей</h2>
    <p class="muted">Записи хранятся только на этом телефоне. Сохраните копию в файл, чтобы не потерять их при смене или потере телефона. Из файла записи можно загрузить на новый телефон.</p>
    <p class="muted">Последняя копия: <b>${last ? `${shortDate(last)} ${last.getFullYear()}` : "ещё не сохраняли"}</b></p>
    ${stale ? `<div class="alert"><span>${last ? "С последней копии прошло больше двух недель." : "Копии ещё нет."} Сохраните её, это займёт минуту.</span></div>` : ""}
    <button class="btn ghost" id="backup-save">Сохранить копию</button>
    <button class="btn ghost" id="backup-load">Загрузить копию</button>
    <input type="file" id="backup-file" accept=".json,application/json" hidden>
    ${privacy("Файл копии никуда не отправляется. Храните его там, где его не увидят посторонние: в нём ваш дневник и ответы.")}
  </section>`;
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

async function saveBackup() {
  if (!loaded) { await load(); if (!loaded) throw storageError || new Error("Хранилище недоступно"); }
  const data = {};
  BACKUP_KEYS.forEach(k => { if (S[k]) data[k] = S[k]; });
  const stamp = now();
  const json = JSON.stringify({ app: BACKUP_APP, format: 1, exportedAt: stamp.toISOString(), data }, null, 1);
  const name = `dbt-kopiya-${dayKey(stamp)}.json`;
  const file = new File([json], name, { type: "application/json" });
  let done = false;
  // На iPhone надёжнее через «Поделиться» → «Сохранить в Файлы»
  if (isIOS() && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Копия записей DBT" }); done = true; }
    catch (e) { if (e.name === "AbortError") return false; }
  }
  if (!done) {
    const url = URL.createObjectURL(file), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  await commit("meta", m => { m.lastBackup = stamp.toISOString(); return m; });
  return true;
}

// Объединение копии с тем, что уже есть на телефоне. Ничего не стирается.
function mergeBackup(cur, inc) {
  const out = clone(cur);
  // Ответы: на телефоне ответа нет — берём из копии
  out.answers = { ...(inc.answers || {}), ...(cur.answers || {}) };
  // Практики и разборы цепочек: объединяем по неделям без повторов
  for (const k of ["practices", "chains"]) {
    const res = clone(cur[k] || {});
    Object.entries(inc[k] || {}).forEach(([w, list]) => {
      const have = res[w] || [];
      const ids = new Set(have.map(p => p.id || p.date + (p.sit || p.beh || "")));
      (list || []).forEach(p => { const id = p.id || p.date + (p.sit || p.beh || ""); if (!ids.has(id)) { have.push(p); ids.add(id); } });
      res[w] = have.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    });
    out[k] = res;
  }
  // Отметки: галочка стоит, если она есть хоть где-то
  const marks = clone(cur.marks || {});
  Object.entries(inc.marks || {}).forEach(([w, m]) => {
    const r = marks[w] = marks[w] || {};
    Object.entries(m || {}).forEach(([f, v]) => { if (v) r[f] = true; });
  });
  out.marks = marks;
  // Дневник: на один день — более поздняя по сохранению запись
  const diary = clone(cur.diary || {});
  Object.entries(inc.diary || {}).forEach(([d, e]) => {
    if (!diary[d] || String(e.saved || "") > String(diary[d].saved || "")) diary[d] = e;
  });
  out.diary = diary;
  // Таблица навыков: объединяем недели
  const grid = clone(cur.grid || {});
  Object.entries(inc.grid || {}).forEach(([n, ws]) => {
    grid[n] = [...new Set([...(grid[n] || []), ...(ws || [])])].sort((a, b) => a - b);
  });
  out.grid = grid;
  return out;
}

async function loadBackup(fileObj) {
  let parsed;
  try { parsed = JSON.parse(await fileObj.text()); } catch (e) { toast("Это не файл копии. Выберите файл dbt-kopiya-….json"); return; }
  if (!parsed || parsed.app !== BACKUP_APP || !parsed.data) { toast("Это не файл копии этого приложения"); return; }
  const when = parsed.exportedAt ? new Date(parsed.exportedAt) : null;
  const ok = confirm(`Загрузить записи из копии${when ? ` от ${shortDate(when)} ${when.getFullYear()}` : ""}?\n\nОни добавятся к записям на этом телефоне. Ничего не удалится.`);
  if (!ok) return;
  if (!loaded) { await load(); if (!loaded) { saveFailed(storageError || new Error("Хранилище недоступно")); return; } }
  const merged = mergeBackup(Object.fromEntries(BACKUP_KEYS.map(k => [k, S[k] || {}])), parsed.data);
  try { for (const k of BACKUP_KEYS) await commit(k, () => merged[k]); }
  catch (err) { return saveFailed(err); }
  render(); toast("Записи из копии загружены");
}

// ---------- Навыки ----------
let skillsMode = "grid", gridSel = null, skillFilter = null, gridScrolled = false;
const GRID_ROWS = D.skillsGrid.flatMap(g => g.rows);

function viewSkills() {
  return `${storageAlert()}<h1>Навыки</h1>
  <div class="seg" role="tablist" aria-label="Вид">
    <button role="tab" data-smode="grid" aria-selected="${skillsMode === "grid"}">Моя таблица</button>
    <button role="tab" data-smode="list" aria-selected="${skillsMode === "list"}">Список навыков</button>
  </div>
  ${skillsMode === "grid" ? gridBody() : listBody()}`;
}

function gridBody() {
  const weeksOf = n => S.grid[n] || [];
  const used = GRID_ROWS.filter(r => weeksOf(r.n).length).length;
  const weeks = new Set(GRID_ROWS.flatMap(r => weeksOf(r.n))).size;
  const W = Array.from({ length: TOTAL }, (_, i) => i + 1);
  const sel = gridSel && GRID_ROWS.find(r => r.n === gridSel);
  const selWeeks = sel ? [...weeksOf(sel.n)].sort((a, b) => a - b) : [];
  return `
  <p class="muted">Нажмите на клетку, если применяли навык на этой неделе. Нажмите на название, чтобы прочитать, что значит навык.</p>
  <section class="card"><div class="stat">
    <div><b>${used} из ${GRID_ROWS.length}</b><span class="muted">навыков уже применял</span></div>
    <div><b>${weeks} из ${TOTAL}</b><span class="muted">недель с практикой</span></div>
  </div></section>
  ${sel ? `<section class="card skill" id="skill-card">
    <span class="eyebrow">Вводится на сессии ${sel.s}</span>
    <h2>${esc(sel.n)}</h2><p>${esc(sel.d)}</p>
    <p class="muted">Применял недель: <b>${selWeeks.length}</b>${selWeeks.length ? ` (${selWeeks.join(", ")})` : ""}</p>
    <button class="chip" data-gskill="${esc(sel.n)}" style="align-self:flex-start">Закрыть</button>
  </section>` : ""}
  <div class="grid-wrap"><table class="grid">
    <thead><tr><th class="sk"><span class="muted">Неделя</span></th>${W.map(w => `<th class="wk ${w === CURRENT ? "cur" : ""}" scope="col">${w}</th>`).join("")}</tr></thead>
    <tbody>${D.skillsGrid.map(g => `<tr class="modrow"><th class="sk" scope="rowgroup">${esc(g.mod)}</th><td colspan="${TOTAL}"></td></tr>` + g.rows.map(r => {
      const on = weeksOf(r.n);
      return `<tr><th class="sk" scope="row"><button data-gskill="${esc(r.n)}" class="${gridSel === r.n ? "sel" : ""}">${esc(r.n)}<small>${on.length} нед.</small></button></th>${W.map(w =>
        `<td class="${w === CURRENT ? "cur" : ""}"><button class="cell ${on.includes(w) ? "on" : w < r.s ? "pre" : ""}" data-cell="${esc(r.n)}|${w}" aria-pressed="${on.includes(w)}" aria-label="${esc(r.n)}, неделя ${w}"></button></td>`).join("")}</tr>`;
    }).join("")).join("")}</tbody>
  </table></div>
  <div class="legend">
    <span><i style="background:var(--done);border-color:var(--done)"></i>применял</span>
    <span><i></i>не применял</span>
    <span><i style="background:var(--bg);border-color:var(--bg)"></i>навык ещё не проходили</span>
    <span><i style="border-color:var(--accent)"></i>текущая неделя</span>
  </div>
  ${privacy("Таблица хранится только на этом телефоне. Навыки, отмеченные в дневнике, появляются здесь сами.")}`;
}

function listBody() {
  const cur = skillFilter || moduleOf(CURRENT);
  const m = D.skillsList.find(s => s.mod === cur) || D.skillsList[0];
  return `
  <div class="tabs-filter" role="group" aria-label="Модуль">${D.skillsList.map(s => `<button class="chip ${s.mod === m.mod ? "on" : ""}" data-smod="${esc(s.mod)}" aria-pressed="${s.mod === m.mod}">${esc(s.mod)}</button>`).join("")}</div>
  ${m.items.map(it => `<section class="card skill"><h2>${esc(it.t)}</h2>${it.d ? `<p>${esc(it.d)}</p>` : ""}${it.list ? `<ul>${it.list.map(([a, b]) => `<li>${a ? `<b>${esc(a)}</b>` : "· "}${esc(b)}</li>`).join("")}</ul>` : ""}</section>`).join("")}
  <p class="muted">Подробно каждый навык ведущий объясняет на встрече.</p>`;
}

// Таблица листается вбок: сохраняем прокрутку при перерисовке, при первом показе — к текущей неделе
function renderKeepingGridScroll() {
  const gw = document.querySelector(".grid-wrap"), x = gw ? gw.scrollLeft : 0, y = window.scrollY;
  render();
  const nw = document.querySelector(".grid-wrap");
  if (nw) nw.scrollLeft = x;
  window.scrollTo(0, y);
}
function scrollGridToCurrent() {
  // В шпаргалке выбранный модуль должен быть виден в ряду кнопок
  const chip = document.querySelector(".tabs-filter .chip.on");
  if (chip) { const f = chip.parentElement; f.scrollLeft = chip.offsetLeft - f.offsetLeft - 16; }
  const gw = document.querySelector(".grid-wrap");
  if (!gw || gridScrolled) return;
  gridScrolled = true;
  const th = gw.querySelector("th.wk.cur");
  if (th) gw.scrollLeft = Math.max(0, th.offsetLeft - 122 - 3 * 31);
}

// ---------- Группа (ведущий и координатор) ----------
const isLeader = () => !!(S.meta && S.meta.role === "leader");

function viewGroup() {
  const s = D.sessions[CURRENT], next = nextMeeting();
  const moves = Object.keys(D.moves || {}).map(Number).sort((a, b) => a - b);
  const rows = [];
  for (let n = 1; n <= TOTAL; n++) {
    const st = n < CURRENT ? "past" : n === CURRENT ? "cur" : "";
    const d = sessDate(n);
    rows.push(`<span class="n ${st}">${n}</span><span class="${st}">${shortDate(d)}, ${hm(d)}${isMoved(n) ? " · перенесена" : ""}<br><span class="muted">${esc(D.sessions[n].t)} · <span class="codes">${esc(D.sessions[n].codes)}</span></span></span>`);
  }
  return `${storageAlert()}<span class="eyebrow">Для ведущего и координатора</span>
  <h1>${esc(D.group.name)}</h1>
  <section class="card">
    <span class="eyebrow">Сессия ${CURRENT} из ${TOTAL} · ${esc(moduleOf(CURRENT))}</span>
    <h2>${esc(s.t)}</h2>
    <p class="muted codes">Материалы пособия: <b>${esc(s.codes)}</b></p>
    <p class="muted">Задание участникам: ${esc(s.task.title)}</p>
    <p class="muted">Вопрос недели: ${esc(s.q)}</p>
    <p class="muted">Чтение: ${s.read ? `Ван Дейк, ${esc(s.read)}` : "на этой неделе не читаем"}</p>
  </section>
  <section class="card">
    <h2>Отметки участников</h2>
    <p class="muted">В этой версии отметки никуда не отправляются: участники показывают их на встрече. Сводка по участникам появится здесь, когда подключим сервер отметок (шаг 4 в ТЗ).</p>
  </section>
  <section class="card">
    <h2>Расписание</h2>
    <p class="muted">${next ? `Следующая встреча: <b>сессия ${next}, ${longDate(sessDate(next))}</b>` : `Все ${TOTAL} встреч прошли.`}</p>
    ${moves.length ? `<div class="entry"><span class="eyebrow">Переносы</span>${moves.map(n => `<span>Сессия ${n} перенесена на ${longDate(sessDate(n))}</span>`).join("")}</div>` : ""}
    <p class="muted">Чтобы перенести встречу, напишите разработчику приложения: какую сессию, новую дату и время. Все следующие встречи сдвинутся и пойдут раз в неделю от новой даты. Участники увидят новое расписание при следующем открытии приложения с интернетом.</p>
  </section>
  <section class="card">
    <h2>Разбор цепочки</h2>
    <p class="muted">${chainOn()
      ? `<b>Включён${CHAIN_FROM && !D.chainEnabled ? ` с сессии ${CHAIN_FROM}` : ""}:</b> участники видят карточку разбора и четвёртую галочку.`
      : CHAIN_FROM
        ? `<b>Включится сам на сессии ${CHAIN_FROM}</b>, ${longDate(sessDate(CHAIN_FROM))}. В эту неделю участники при первом открытии приложения попадут на экран разбора, а карточка будет первой на «Сегодня» с пометкой «Новое».`
        : "<b>Выключен.</b>"}</p>
    <p class="muted">Если объяснение разбора переносится на другую сессию, напишите разработчику, и номер сессии поменяют для всех.</p>
  </section>
  <section class="card">
    <h2>Все сессии</h2>
    <div class="sched">${rows.join("")}</div>
  </section>
  ${privacy("На этом экране нет личных записей участников. Коды материалов видят только ведущий и координатор.")}
  <button class="linkbtn" id="leader-off">Выйти из режима ведущего</button>`;
}

const VIEWS = {
  today: viewToday,
  practice: viewPractice,
  plan: viewPlan,
  chain: viewChain,
  diary: viewDiary,
  skills: viewSkills,
  group: viewGroup,
};
const NAV_OF = { practice: "today", chain: "today" };

// ---------- Навигация ----------
const route = () => {
  const r = location.hash.slice(1);
  if (r === "group" && !isLeader()) return "today";
  return VIEWS[r] ? r : "today";
};
function render() {
  const r = route();
  $("#app").innerHTML = VIEWS[r]();
  const navTab = NAV_OF[r] || r;
  document.querySelectorAll("nav button").forEach(b => {
    b.setAttribute("aria-current", b.dataset.tab === navTab ? "page" : "false");
    if (b.dataset.tab === "group") b.hidden = !isLeader();
  });
}
function go(r) {
  if (location.hash.slice(1) === r) { render(); window.scrollTo(0, 0); return; }
  location.hash = r;
}
window.addEventListener("hashchange", () => { editAns = false; if (route() !== "chain") chainIntro = false; gridScrolled = false; render(); window.scrollTo(0, 0); scrollGridToCurrent(); });

// Приложение могло пролежать в фоне несколько дней: пересчитываем текущую сессию
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const c = calcCurrent();
  if (c !== CURRENT) { CURRENT = c; editAns = false; render(); showChainIntroOnce(); }
});

// ---------- Действия ----------
document.addEventListener("click", async e => {
  const b = e.target.closest("button");
  if (!b) return;

  if (b.dataset.tab) return go(b.dataset.tab);
  if (b.dataset.go) return go(b.dataset.go);

  if (b.id === "retry-db") {
    const drafts = S.drafts;
    await load();
    if (loaded) { S.drafts = { ...S.drafts, ...drafts }; toast("Хранилище снова доступно"); }
    else toast("Пока не получается. Попробуйте позже.");
    return render();
  }

  if (b.dataset.mark) {
    const k = b.dataset.mark;
    try { await commit("marks", m => { m[CURRENT] = { ...(m[CURRENT] || {}), [k]: !(m[CURRENT] || {})[k] }; return m; }); }
    catch (err) { return saveFailed(err); }
    return render();
  }

  if (b.id === "save-ans") {
    const text = (S.drafts.ans[CURRENT] || "").trim();
    if (!text) { toast("Сначала напишите ответ"); $("#ans").focus(); return; }
    try { await commit("answers", a => { a[CURRENT] = text; return a; }); } catch (err) { return saveFailed(err); }
    delete S.drafts.ans[CURRENT]; saveDraftsSoon();
    editAns = false; render(); toast("Ответ сохранён на этом телефоне");
    return;
  }
  if (b.id === "edit-ans") {
    editAns = true; S.drafts.ans[CURRENT] = S.answers[CURRENT] || "";
    render(); const t = $("#ans"); t.focus(); t.setSelectionRange(t.value.length, t.value.length);
    return;
  }
  if (b.id === "cancel-ans") { editAns = false; delete S.drafts.ans[CURRENT]; saveDraftsSoon(); return render(); }

  if (b.dataset.step) {
    const fd = form(), t = b.dataset.step, order = D.sessions[CURRENT].task.steps.map(x => x[1]);
    fd.steps = fd.steps.includes(t) ? fd.steps.filter(x => x !== t) : [...fd.steps, t].sort((a, c) => order.indexOf(a) - order.indexOf(c));
    saveDraftsSoon();
    const on = fd.steps.includes(t);
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
    return;
  }
  if (b.dataset.res) {
    const fd = form();
    fd.res = fd.res === b.dataset.res ? "" : b.dataset.res;
    saveDraftsSoon();
    b.parentElement.querySelectorAll("[data-res]").forEach(x => { const on = x.dataset.res === fd.res; x.classList.toggle("on", on); x.setAttribute("aria-pressed", on); });
    return;
  }
  if (b.id === "save-form") {
    const fd = form();
    if (!fd.sit.trim()) { toast("Опишите ситуацию в первом пункте"); $("#sit").focus(); return; }
    const entry = {
      id: Date.now(), date: now().toISOString(),
      sit: fd.sit.trim(), before: fd.before, steps: [...fd.steps], did: fd.did.trim(), after: fd.after, res: fd.res, note: fd.note.trim(),
    };
    try { await commit("practices", p => { (p[CURRENT] = p[CURRENT] || []).unshift(entry); return p; }); }
    catch (err) { return saveFailed(err); }
    S.drafts.form[CURRENT] = emptyForm(); saveDraftsSoon();
    // Галочка «задание недели» ставится сама
    if (!marksOf(CURRENT).hw) {
      try { await commit("marks", m => { m[CURRENT] = { ...(m[CURRENT] || {}), hw: true }; return m; }); }
      catch (err) { console.error(err); }
    }
    render(); toast("Практика сохранена на этом телефоне");
    const h = [...document.querySelectorAll("h2")].find(x => x.textContent.startsWith("Мои практики"));
    if (h) h.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  // ----- Режим ведущего -----
  if (b.id === "leader-on") {
    const code = prompt("Код ведущего или координатора:");
    if (code == null) return;
    if (code.trim() !== String(D.group.leaderCode)) { toast("Код не подошёл"); return; }
    try { await commit("meta", m => { m.role = "leader"; return m; }); } catch (err) { return saveFailed(err); }
    toast("Вкладка «Группа» включена");
    return go("group");
  }
  if (b.id === "leader-off") {
    try { await commit("meta", m => { delete m.role; return m; }); } catch (err) { return saveFailed(err); }
    toast("Режим ведущего выключен");
    return go("today");
  }

  // ----- Анализ цепочки -----
  if (b.dataset.vuln || b.dataset.chsk) {
    const cd = chainDraft(), key = b.dataset.vuln ? "vuln" : "skills", v = b.dataset.vuln || b.dataset.chsk;
    cd[key] = cd[key].includes(v) ? cd[key].filter(x => x !== v) : [...cd[key], v];
    saveDraftsSoon();
    const on = cd[key].includes(v);
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
    updateChainPreview();
    return;
  }
  if (b.dataset.ltype) {
    const i = b.dataset.ltype.indexOf("|"), n = +b.dataset.ltype.slice(0, i), t = b.dataset.ltype.slice(i + 1);
    chainDraft().links[n].type = t; saveDraftsSoon();
    b.parentElement.querySelectorAll("[data-ltype]").forEach(x => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", on); });
    updateChainPreview();
    return;
  }
  if (b.dataset.lrm) {
    chainDraft().links.splice(+b.dataset.lrm, 1); saveDraftsSoon();
    const y = window.scrollY; render(); window.scrollTo(0, y);
    return;
  }
  if (b.id === "add-link") {
    chainDraft().links.push({ type: D.linkTypes[0], text: "" }); saveDraftsSoon();
    const y = window.scrollY; render(); window.scrollTo(0, y);
    const t = document.querySelectorAll("[data-ltext]"); if (t.length) t[t.length - 1].focus();
    return;
  }
  if (b.id === "save-chain") {
    const cd = chainDraft();
    if (!cd.beh.trim() || !cd.event.trim()) {
      toast("Заполните хотя бы первые два пункта");
      $(cd.beh.trim() ? "#ch-event" : "#ch-beh").focus(); return;
    }
    const week = CURRENT;
    const entry = { ...clone(cd), id: Date.now(), date: now().toISOString(), links: cd.links.filter(l => l.text.trim()).map(l => ({ type: l.type, text: l.text.trim() })) };
    Object.values(CHAIN_FIELDS).forEach(f => { entry[f] = entry[f].trim(); });
    try { await commit("chains", c => { (c[week] = c[week] || []).unshift(entry); return c; }); }
    catch (err) { return saveFailed(err); }
    S.drafts.chain = null; saveDraftsSoon();
    // Галочка «разобрал цепочку» ставится сама
    if (!marksOf(week).chain) {
      try { await commit("marks", m => { m[week] = { ...(m[week] || {}), chain: true }; return m; }); }
      catch (err) { console.error(err); }
    }
    render(); toast("Разбор сохранён на этом телефоне");
    const h = [...document.querySelectorAll("h2")].find(x => x.textContent === "Мои разборы");
    if (h) h.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  // ----- Копия записей -----
  if (b.id === "backup-save") {
    try { if (await saveBackup()) { render(); toast("Копия сохранена в файл"); } }
    catch (err) { saveFailed(err); }
    return;
  }
  if (b.id === "backup-load") { const f = $("#backup-file"); f.value = ""; f.click(); return; }

  // ----- Навыки -----
  if (b.dataset.smode) { skillsMode = b.dataset.smode; gridScrolled = false; render(); scrollGridToCurrent(); return; }
  if (b.dataset.smod) {
    const f = document.querySelector(".tabs-filter"), x = f ? f.scrollLeft : 0;
    skillFilter = b.dataset.smod; renderKeepingGridScroll();
    const nf = document.querySelector(".tabs-filter"); if (nf) nf.scrollLeft = x;
    return;
  }
  if (b.dataset.gskill) {
    gridSel = gridSel === b.dataset.gskill ? null : b.dataset.gskill;
    renderKeepingGridScroll();
    const card = $("#skill-card");
    if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }
  if (b.dataset.cell) {
    const i = b.dataset.cell.lastIndexOf("|"), n = b.dataset.cell.slice(0, i), wk = +b.dataset.cell.slice(i + 1);
    try { await commit("grid", g => { const a = g[n] || []; g[n] = a.includes(wk) ? a.filter(x => x !== wk) : [...a, wk].sort((x, y) => x - y); return g; }); }
    catch (err) { return saveFailed(err); }
    return renderKeepingGridScroll();
  }

  // ----- Дневник -----
  if (b.dataset.dday) {
    const dr = diaryDraft(), k = b.dataset.dday;
    if (dr.day === k) return;
    // За выбранный день запись есть — показываем её. Нет — переносим несохранённое набранное,
    // а если на прошлом дне была уже сохранённая запись, начинаем с чистой формы.
    S.drafts.diary = S.diary[k] ? diaryFromEntry(k) : S.diary[dr.day] ? emptyDiary(k) : { ...dr, day: k };
    saveDraftsSoon(); return render();
  }
  if (b.dataset.em || b.dataset.dsk) {
    const dr = diaryDraft(), key = b.dataset.em ? "em" : "sk", v = b.dataset.em || b.dataset.dsk;
    dr[key] = dr[key].includes(v) ? dr[key].filter(x => x !== v) : [...dr[key], v];
    saveDraftsSoon();
    const on = dr[key].includes(v);
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
    return;
  }
  if (b.id === "save-diary") {
    const dr = diaryDraft();
    if (!dr.em.length && !dr.sk.length && !dr.note.trim()) { toast("Отметьте эмоции, навыки или напишите заметку"); return; }
    const week = weekOfDay(dr.day);
    const entry = { day: dr.day, week, em: [...dr.em], power: dr.power, sk: [...dr.sk], note: dr.note.trim(), saved: now().toISOString() };
    try { await commit("diary", d => { d[entry.day] = entry; return d; }); }
    catch (err) { return saveFailed(err); }
    S.drafts.diary = null; saveDraftsSoon();
    // Навыки из записи сами отмечаются в таблице навыков на этой неделе
    if (entry.sk.length) {
      try { await commit("grid", g => { entry.sk.forEach(n => { const a = g[n] || []; if (!a.includes(week)) g[n] = [...a, week].sort((x, y) => x - y); }); return g; }); }
      catch (err) { console.error(err); }
    }
    // Галочка «дневник» — когда за неделю набралось нужное число дней
    if (!marksOf(week).diary && diaryDaysInWeek(week) >= DIARY_DAYS_FOR_MARK) {
      try { await commit("marks", m => { m[week] = { ...(m[week] || {}), diary: true }; return m; }); }
      catch (err) { console.error(err); }
    }
    render(); toast("Запись сохранена на этом телефоне");
    return;
  }

  if (b.dataset.sess) {
    const n = +b.dataset.sess;
    openSess.has(n) ? openSess.delete(n) : openSess.add(n);
    b.classList.toggle("open", openSess.has(n)); b.setAttribute("aria-expanded", openSess.has(n));
    return;
  }
});

document.addEventListener("change", e => {
  if (e.target.id === "backup-file" && e.target.files && e.target.files[0]) loadBackup(e.target.files[0]);
});

document.addEventListener("input", e => {
  const el = e.target, id = el.id;
  if (id === "ans") { S.drafts.ans[CURRENT] = el.value; saveDraftsSoon(); return; }
  if (id === "sit" || id === "did" || id === "fnote") {
    form()[id === "fnote" ? "note" : id] = el.value; saveDraftsSoon(); return;
  }
  if (CHAIN_FIELDS[id]) { chainDraft()[CHAIN_FIELDS[id]] = el.value; saveDraftsSoon(); updateChainPreview(); return; }
  if (el.dataset && el.dataset.ltext !== undefined) {
    const l = chainDraft().links[+el.dataset.ltext]; if (l) l.text = el.value;
    saveDraftsSoon(); updateChainPreview(); return;
  }
  if (id === "dnote") { diaryDraft().note = el.value; saveDraftsSoon(); return; }
  if (id === "power") { diaryDraft().power = +el.value; $("#power-v").textContent = el.value; saveDraftsSoon(); return; }
  if (id === "before" || id === "after") {
    form()[id] = +el.value; $("#" + id + "-v").textContent = el.value; saveDraftsSoon();
  }
});

// ---------- Запуск ----------
(async function start() {
  await load();
  if (loaded) DB.persist();
  render();
  scrollGridToCurrent();
  showChainIntroOnce();
})();

// ---------- Офлайн и обновления ----------
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(e => console.error("SW", e));
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return; // первая установка, обновлять нечего
    const u = $("#update");
    u.innerHTML = `<div class="alert" style="color:var(--ink);background:var(--card);box-shadow:0 4px 20px rgba(0,0,0,.15)">
      <span>Вышла новая версия приложения.</span><button class="btn" id="do-update">Обновить</button></div>`;
    u.hidden = false;
  });
  document.addEventListener("click", e => {
    if (e.target.id !== "do-update") return;
    clearTimeout(draftTimer);
    (loaded ? DB.set("drafts", S.drafts) : Promise.resolve()).finally(() => location.reload());
  });
}
})();

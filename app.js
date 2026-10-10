// «Тренинг навыков DBT» — первая версия без сервера.
// Содержание берётся из data.js, личные записи лежат в IndexedDB (db.js).
(() => {
"use strict";
const D = window.DBT_DATA;
const TOTAL = 24;

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
const EMPTY = () => ({ answers: {}, practices: {}, marks: {}, drafts: { ans: {}, form: {} } });
let S = EMPTY();
let loaded = false, storageError = null;
let CURRENT = calcCurrent();
let editAns = false;
const openSess = new Set();

const emptyForm = () => ({ sit: "", before: 3, steps: [], did: "", after: 2, res: "", note: "" });
const form = () => (S.drafts.form[CURRENT] = S.drafts.form[CURRENT] || emptyForm());
const marksOf = n => S.marks[n] || {};

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
    <span class="read">Читаем: Ван Дейк, ${esc(s.read)}</span>
    <div class="bar" role="progressbar" aria-label="Пройдено сессий" aria-valuemin="0" aria-valuemax="${TOTAL}" aria-valuenow="${CURRENT}"><i style="width:${CURRENT / TOTAL * 100}%"></i></div>
  </div>
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
  ${D.chainEnabled ? `<section class="card">
    <span class="eyebrow">Каждую неделю</span>
    <h2>Анализ поведенческой цепочки</h2>
    <p class="muted">Выберите один случай недели, когда поступили так, как не хотели бы. Разберите его по звеньям и найдите, где можно было разорвать цепочку.</p>
    <button class="btn ghost" data-go="chain">Разобрать цепочку</button>
  </section>` : ""}
  <section class="card">
    <h2>Мои отметки за неделю</h2>
    ${item("diary", "Заполнял дневник", "хотя бы 4 дня из 7")}
    ${item("hw", "Сделал задание недели", s.task.title)}
    ${D.chainEnabled ? item("chain", "Разобрал цепочку", "анализ поведенческой цепочки") : ""}
    ${item("read", "Прочитал главу", `Ван Дейк, ${s.read}`)}
    <p class="muted">В этой версии отметки никуда не отправляются. Покажите их ведущему на встрече.</p>
    ${privacy("Ведущий увидит только эти галочки. Ответы, практики и дневник остаются на вашем телефоне.")}
  </section>
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
  <p class="muted">24 сессии, ${esc(D.group.name)}. Нажмите на сессию, чтобы увидеть чтение, вопрос и задание.</p>` +
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
            <span><b>Читаем:</b> Ван Дейк, ${esc(s.read)}</span>
            <span><b>Вопрос:</b> ${esc(s.q)}</span>
            <span><b>Задание:</b> ${esc(s.task.title)}</span>
            ${S.answers[i] ? `<span><b>Мой ответ:</b> ${esc(S.answers[i])}</span>` : ""}
          </span>
        </span></button>`;
    }
    return `<section class="module"><span class="eyebrow">${esc(m.name)} · сессии ${m.from}–${m.to}</span>${rows}</section>`;
  }).join("");
}

const soon = (title, text) => `<h1>${title}</h1><section class="card"><p>${text}</p><p class="muted">Этот раздел появится в следующей сборке приложения.</p></section>`;
const VIEWS = {
  today: viewToday,
  practice: viewPractice,
  plan: viewPlan,
  chain: () => soon("Анализ поведенческой цепочки", "Разбор цепочки по восьми шагам."),
  diary: () => soon("Дневник", "Запись за день: эмоции, их сила, применённые навыки и заметка."),
  skills: () => soon("Навыки", "Ваша таблица навыков по неделям и шпаргалка с расшифровкой аббревиатур."),
  group: () => soon("Группа", "Раздел для ведущего и координатора: отметки участников, расписание и переносы."),
};
const NAV_OF = { practice: "today", chain: "today" };

// ---------- Навигация ----------
const route = () => { const r = location.hash.slice(1); return VIEWS[r] ? r : "today"; };
function render() {
  const r = route();
  $("#app").innerHTML = VIEWS[r]();
  const navTab = NAV_OF[r] || r;
  document.querySelectorAll("nav button").forEach(b => b.setAttribute("aria-current", b.dataset.tab === navTab ? "page" : "false"));
}
function go(r) {
  if (location.hash.slice(1) === r) { render(); window.scrollTo(0, 0); return; }
  location.hash = r;
}
window.addEventListener("hashchange", () => { editAns = false; render(); window.scrollTo(0, 0); });

// Приложение могло пролежать в фоне несколько дней: пересчитываем текущую сессию
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const c = calcCurrent();
  if (c !== CURRENT) { CURRENT = c; editAns = false; render(); }
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

  if (b.dataset.sess) {
    const n = +b.dataset.sess;
    openSess.has(n) ? openSess.delete(n) : openSess.add(n);
    b.classList.toggle("open", openSess.has(n)); b.setAttribute("aria-expanded", openSess.has(n));
    return;
  }
});

document.addEventListener("input", e => {
  const el = e.target, id = el.id;
  if (id === "ans") { S.drafts.ans[CURRENT] = el.value; saveDraftsSoon(); return; }
  if (id === "sit" || id === "did" || id === "fnote") {
    form()[id === "fnote" ? "note" : id] = el.value; saveDraftsSoon(); return;
  }
  if (id === "before" || id === "after") {
    form()[id] = +el.value; $("#" + id + "-v").textContent = el.value; saveDraftsSoon();
  }
});

// ---------- Запуск ----------
(async function start() {
  await load();
  if (loaded) DB.persist();
  render();
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

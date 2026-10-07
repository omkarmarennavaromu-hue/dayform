(() => {
  'use strict';

  const STORAGE_KEY = 'dayform.local.v1';
  const RECOVERY_KEY = `${STORAGE_KEY}.recovery`;
  const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
  const appPage = document.getElementById('page-content');
  const noticeArea = document.getElementById('notice-area');
  const topbarDate = document.getElementById('topbar-date');
  const saveStatus = document.getElementById('save-status');
  const historyCount = document.getElementById('history-count');
  const fileInput = document.getElementById('import-file');
  const dialog = document.getElementById('app-dialog');
  const dialogContent = document.getElementById('dialog-content');
  const toastRegion = document.getElementById('toast-region');

  let data = emptyData();
  let todayKey = localDateKey(new Date());
  let activeView = 'today';
  let selectedHistoryKey = '';
  let addFormOpen = false;
  let loadIssue = '';
  let rawRecoveryText = '';
  let recoveryCopySaved = false;
  let storageWriteError = false;
  let progressAnimationFrom = null;
  let flashTaskId = '';
  let undoRecord = null;
  let undoTimer = null;
  let toastTimer = null;
  let midnightTimer = null;
  let pendingImport = null;
  let pendingImportRecovered = false;
  let pendingImportRawText = '';

  const iconPaths = {
    plus: '<path d="M10 3.5v13M3.5 10h13"/>',
    check: '<path d="m4 10.2 3.8 3.8L16 5.8"/>',
    edit: '<path d="M11.5 4.5H5.8A1.8 1.8 0 0 0 4 6.3v7.9A1.8 1.8 0 0 0 5.8 16h7.9a1.8 1.8 0 0 0 1.8-1.8V8.5M9 11l.6-2.5L14.9 3a1.5 1.5 0 0 1 2.1 2.1l-5.5 5.3L9 11Z"/>',
    trash: '<path d="M4.5 6h11M8 6V4h4v2m2.5 0-.6 9.1a1.5 1.5 0 0 1-1.5 1.4H7.6a1.5 1.5 0 0 1-1.5-1.4L5.5 6m3 2.5v5m3-5v5"/>',
    clock: '<circle cx="10" cy="10" r="7"/><path d="M10 6v4.3l2.8 1.8"/>',
    note: '<path d="M5 3.5h8l3 3v10H5zM13 3.5v3h3M7.5 10h6M7.5 13h5"/>',
    flame: '<path d="M10.2 17a3.2 3.2 0 0 0 3.2-3.2c0-2.2-1.4-3.3-2.7-5.8-.1 1.6-.9 2.4-1.6 3.1-.4-1.8-1.5-3.3-2.8-4.5.1 2-.8 3.1-1.4 4.5A5.4 5.4 0 0 0 10.2 17Z"/><path d="M10 17.5a7.1 7.1 0 0 0 6.4-7.1c0-2-.9-3.8-2.4-5.2.1 2.1-.5 3.2-1.1 4.2"/>',
    warning: '<path d="M10 3.2 18 17H2L10 3.2Z"/><path d="M10 7.8v4.3m0 2.4h.01"/>',
    spark: '<path d="m10 2.7 1.5 5.8 5.8 1.5-5.8 1.5-1.5 5.8-1.5-5.8-5.8-1.5 5.8-1.5L10 2.7Z"/>',
    arrow: '<path d="M4 10h12m-5-5 5 5-5 5"/>',
    close: '<path d="m5 5 10 10M15 5 5 15"/>',
    archive: '<path d="M3 5h14v11H3zM2 3h16v2H2zM7 9h6"/>',
    calendar: '<rect x="3" y="4" width="14" height="13" rx="2"/><path d="M6.5 2.5v3M13.5 2.5v3M3 8h14m-10 3h2m3 0h2m-7 3h2"/>',
    checkCircle: '<circle cx="10" cy="10" r="7"/><path d="m6.8 10.1 2.1 2.1 4.3-4.5"/>',
    list: '<path d="M7 5h10M7 10h10M7 15h10M3.5 5h.01M3.5 10h.01M3.5 15h.01"/>'
  };

  function icon(name, className = '') {
    return `<svg${className ? ` class="${className}"` : ''} viewBox="0 0 20 20" aria-hidden="true">${iconPaths[name] || ''}</svg>`;
  }

  function emptyData() {
    return { schemaVersion: 1, days: {} };
  }

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function createId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  // Date keys are built from local calendar fields, never from UTC/ISO date slicing.
  function localDateKey(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function dateFromKey(key) {
    const parts = String(key).split('-').map(Number);
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return new Date(NaN);
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
  }

  function isValidDateKey(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    const date = dateFromKey(key);
    return Number.isFinite(date.getTime()) && localDateKey(date) === key;
  }

  function offsetDateKey(key, amount) {
    const date = dateFromKey(key);
    date.setDate(date.getDate() + amount);
    return localDateKey(date);
  }

  function formatDate(key, options = {}) {
    const date = dateFromKey(key);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }

  function formatLongDate(key) {
    return formatDate(key, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  function formatMonthYear(key) {
    return formatDate(key, { month: 'long', year: 'numeric' });
  }

  function formatTime(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(value || '');
    if (!match) return '';
    const date = new Date(2000, 0, 1, Number(match[1]), Number(match[2]));
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function validTime(value) {
    if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false;
    const [hour, minute] = value.split(':').map(Number);
    return hour >= 0 && hour < 24 && minute >= 0 && minute < 60;
  }

  function cleanString(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
  }

  function normalizeData(raw) {
    if (!isRecord(raw)) return { fatal: true, reason: 'The file must contain a JSON object.' };
    let rawDays = raw.days;
    if (!isRecord(rawDays) && isRecord(raw.data) && isRecord(raw.data.days)) rawDays = raw.data.days;
    if (!isRecord(rawDays)) return { fatal: true, reason: 'No valid days were found in this data.' };

    const normalized = emptyData();
    let recovered = false;
    let dayCount = 0;
    for (const [key, rawDay] of Object.entries(rawDays)) {
      dayCount += 1;
      if (dayCount > 10000) {
        recovered = true;
        break;
      }
      if (!isValidDateKey(key) || !isRecord(rawDay) || !Array.isArray(rawDay.tasks)) {
        recovered = true;
        continue;
      }
      const tasks = [];
      const seenIds = new Set();
      for (const rawTask of rawDay.tasks) {
        if (!isRecord(rawTask) || typeof rawTask.title !== 'string') {
          recovered = true;
          continue;
        }
        const title = rawTask.title.trim().slice(0, 160);
        if (!title) {
          recovered = true;
          continue;
        }
        let id = typeof rawTask.id === 'string' && rawTask.id.trim() ? rawTask.id.trim().slice(0, 100) : createId();
        if (!id || seenIds.has(id)) {
          id = createId();
          recovered = true;
        }
        seenIds.add(id);
        const priority = ['low', 'medium', 'high'].includes(rawTask.priority) ? rawTask.priority : '';
        if (rawTask.priority && !priority) recovered = true;
        const time = validTime(rawTask.time) ? rawTask.time : '';
        if (rawTask.time && !time) recovered = true;
        const completed = rawTask.completed === true;
        const createdAt = typeof rawTask.createdAt === 'string' && rawTask.createdAt.length < 80
          ? rawTask.createdAt : new Date().toISOString();
        tasks.push({
          id,
          title,
          category: cleanString(rawTask.category, 50),
          priority,
          time,
          notes: cleanString(rawTask.notes, 2000),
          completed,
          createdAt,
          updatedAt: typeof rawTask.updatedAt === 'string' && rawTask.updatedAt.length < 80 ? rawTask.updatedAt : createdAt,
          completedAt: completed && typeof rawTask.completedAt === 'string' && rawTask.completedAt.length < 80 ? rawTask.completedAt : null
        });
      }
      normalized.days[key] = { tasks };
    }
    return { data: normalized, recovered };
  }

  function loadInitialData() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      loadIssue = 'unavailable';
      storageWriteError = true;
      return;
    }
    if (raw === null) return;
    rawRecoveryText = raw;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      loadIssue = 'corrupt';
      return;
    }
    const result = normalizeData(parsed);
    if (result.fatal) {
      loadIssue = 'corrupt';
      return;
    }
    data = result.data;
    if (result.recovered) {
      loadIssue = 'recovered';
      try {
        localStorage.setItem(RECOVERY_KEY, raw);
        recoveryCopySaved = true;
      } catch (error) {
        recoveryCopySaved = false;
      }
    } else {
      rawRecoveryText = '';
    }
  }

  function persistData() {
    if (loadIssue === 'corrupt') return false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      storageWriteError = false;
      return true;
    } catch (error) {
      storageWriteError = true;
      return false;
    }
  }

  function getDay(key = todayKey) {
    return data.days[key] || { tasks: [] };
  }

  function getTasks(key = todayKey) {
    return getDay(key).tasks;
  }

  function getDayProgress(tasks) {
    const total = tasks.length;
    const completed = tasks.reduce((sum, task) => sum + (task.completed ? 1 : 0), 0);
    const percent = total ? Math.round((completed / total) * 100) : 0;
    return { total, completed, percent, isComplete: total > 0 && completed === total };
  }

  function isCompletedDay(key) {
    const tasks = getTasks(key);
    return tasks.length > 0 && tasks.every((task) => task.completed);
  }

  // A day earns a streak only with at least one task and every task complete.
  // Today may still be in progress; it does not break yesterday's run until the date rolls over.
  function getCurrentStreak() {
    let cursor = isCompletedDay(todayKey) ? todayKey : offsetDateKey(todayKey, -1);
    let streak = 0;
    while (isCompletedDay(cursor)) {
      streak += 1;
      cursor = offsetDateKey(cursor, -1);
    }
    return streak;
  }

  function getBestStreak() {
    const keys = Object.keys(data.days).sort();
    let run = 0;
    let best = 0;
    let previousKey = '';
    let previousWasComplete = false;
    for (const key of keys) {
      const qualifies = isCompletedDay(key);
      if (qualifies) {
        run = previousWasComplete && offsetDateKey(previousKey, 1) === key ? run + 1 : 1;
        best = Math.max(best, run);
      } else {
        run = 0;
      }
      previousKey = key;
      previousWasComplete = qualifies;
    }
    return best;
  }

  function getAllTasks() {
    return Object.values(data.days).flatMap((day) => day.tasks);
  }

  function getLoggedDays() {
    return Object.keys(data.days)
      .filter((key) => Array.isArray(data.days[key]?.tasks) && data.days[key].tasks.length > 0)
      .sort((a, b) => b.localeCompare(a));
  }

  function getProgressMessage(progress) {
    if (!progress.total) return 'A fresh page. Add one thing that matters.';
    if (progress.percent === 0) return "Let's start.";
    if (progress.percent === 100) return 'Day completed.';
    if (progress.percent === 50) return 'Halfway there.';
    if (progress.percent >= 80) return 'A little more to go.';
    return 'Nice start. Keep the rhythm.';
  }

  function getPriorityMarkup(priority) {
    if (!priority) return '';
    const label = priority[0].toUpperCase() + priority.slice(1);
    return `<span class="meta-chip priority-chip priority-${priority}">${label}</span>`;
  }

  function getCategoryMarkup(category) {
    return category ? `<span class="meta-chip">${escapeHtml(category)}</span>` : '';
  }

  function isReadOnly() {
    return loadIssue === 'corrupt';
  }

  function renderTask(task) {
    const locked = isReadOnly();
    const completed = task.completed;
    const title = escapeHtml(task.title);
    const taskId = escapeHtml(task.id);
    const taskTime = task.time ? `<span class="task-time">${icon('clock')}<span>${escapeHtml(formatTime(task.time))}</span></span>` : '';
    const note = task.notes ? `<details class="task-note"><summary>${icon('note')}Note</summary><p>${escapeHtml(task.notes)}</p></details>` : '';
    const flash = flashTaskId === task.id && completed ? ' just-completed' : '';
    return `<li class="task-row${completed ? ' is-complete' : ''}${flash}" data-task-id="${taskId}">
      <button class="task-check" type="button" data-action="toggle-task" data-id="${taskId}" aria-label="${completed ? 'Mark' : 'Mark'} ${title} ${completed ? 'not complete' : 'complete'}" aria-pressed="${completed}" ${locked ? 'disabled' : ''}>${icon('check')}</button>
      <div class="task-main">
        <div class="task-title-line"><span class="task-title">${title}</span>${taskTime}</div>
        ${(task.category || task.priority) ? `<div class="task-meta">${getCategoryMarkup(task.category)}${getPriorityMarkup(task.priority)}</div>` : ''}
        ${note}
      </div>
      <div class="task-actions" aria-label="Task actions">
        <button class="icon-button" type="button" data-action="edit-task" data-id="${taskId}" aria-label="Edit ${title}" title="Edit task" ${locked ? 'disabled' : ''}>${icon('edit')}</button>
        <button class="icon-button delete" type="button" data-action="delete-task" data-id="${taskId}" aria-label="Delete ${title}" title="Delete task" ${locked ? 'disabled' : ''}>${icon('trash')}</button>
      </div>
    </li>`;
  }

  function renderQuickAdd() {
    return `<form class="quick-add" id="quick-add-form" autocomplete="off">
      <div class="quick-add-primary">
        <span class="quick-add-leading" aria-hidden="true">+</span>
        <input id="new-task-title" name="title" type="text" maxlength="160" required placeholder="What would you like to get done?" aria-label="Task name">
      </div>
      <details class="optional-details">
        <summary>Add a category, priority, time or note</summary>
        <div class="quick-fields">
          <label class="field"><span>Category · optional</span><input name="category" type="text" maxlength="50" placeholder="Study, health…"></label>
          <label class="field"><span>Priority</span><select name="priority"><option value="">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          <label class="field"><span>Time · optional</span><input name="time" type="time" aria-label="Optional task time"></label>
          <label class="field field-notes"><span>Note · optional</span><textarea name="notes" maxlength="2000" rows="2" placeholder="A small reminder for later…"></textarea></label>
        </div>
      </details>
      <div class="quick-add-footer">
        <span class="quick-add-hint">Press Enter to add</span>
        <button class="subtle-button" type="button" data-action="cancel-add">Cancel</button>
        <button class="solid-button" type="submit">Add task ${icon('arrow')}</button>
      </div>
    </form>`;
  }

  function renderProgressCard(progress) {
    const animated = progressAnimationFrom !== null && activeView === 'today';
    const targetOffset = 100 - progress.percent;
    const startingOffset = animated ? 100 - progressAnimationFrom : targetOffset;
    const offsetStyle = `--progress-offset:${targetOffset};--progress-from-offset:${startingOffset};--progress-width:${progress.percent}%;--progress-from-width:${animated ? progressAnimationFrom : progress.percent}%;`;
    const animateClass = animated ? ' is-animating' : '';
    return `<section class="panel progress-card" aria-label="Today's progress">
      <div class="card-kicker"><span>Daily momentum</span><span class="live-mark">TODAY</span></div>
      <div class="progress-main">
        <div class="progress-ring-wrap">
          <svg class="progress-ring" viewBox="0 0 100 100" role="img" aria-label="${progress.percent}% complete"><circle class="ring-track" cx="50" cy="50" r="43"></circle><circle class="ring-value${animateClass}" cx="50" cy="50" r="43" pathLength="100" style="${offsetStyle}"></circle></svg>
          <span class="progress-ring-label"><span>${progress.percent}</span><small>%</small></span>
        </div>
        <div class="progress-copy"><h3>${progress.completed}<span> / ${progress.total} ${progress.total === 1 ? 'task' : 'tasks'}</span></h3><p>${escapeHtml(getProgressMessage(progress))}</p></div>
      </div>
      <div class="progress-track"><span class="${animateClass.trim()}" style="${offsetStyle}"></span></div>
      <div class="progress-card-bottom"><span>Completed so far</span><strong>${progress.completed} of ${progress.total}</strong></div>
    </section>`;
  }

  function renderStreakCard() {
    const current = getCurrentStreak();
    const best = getBestStreak();
    return `<section class="panel streak-card" aria-label="Streak statistics">
      <div class="streak-card-head"><span class="card-kicker">Consistency</span>${icon('flame')}</div>
      <div class="streak-numbers"><div class="streak-current"><strong>${current}</strong><span>${current === 1 ? 'day' : 'days'}</span></div><span class="streak-divider" aria-hidden="true"></span><div class="streak-best"><small>BEST RUN</small><strong>${best} ${best === 1 ? 'day' : 'days'}</strong></div></div>
      <p class="streak-definition">A streak day means at least one task, all done. Today stays in progress until midnight.</p>
    </section>`;
  }

  function renderTotalsCard() {
    const tasks = getAllTasks();
    const created = tasks.length;
    const completed = tasks.filter((task) => task.completed).length;
    return `<section class="panel totals-card" aria-label="All-time task totals">
      <div class="total-cell"><span>Tasks completed</span><strong>${completed}<small> / ${created}</small></strong></div>
      <div class="total-cell"><span>Tasks created</span><strong>${created}</strong></div>
    </section>`;
  }

  function renderWeekCard() {
    const days = Array.from({ length: 7 }, (_, index) => offsetDateKey(todayKey, index - 6));
    const bars = days.map((key) => {
      const tasks = getTasks(key);
      const progress = getDayProgress(tasks);
      const hasData = progress.total > 0;
      const dayLabel = formatDate(key, { weekday: 'narrow' });
      const accessibleDate = formatDate(key, { weekday: 'long', month: 'long', day: 'numeric' });
      const height = hasData ? progress.percent : 0;
      return `<button class="week-day${hasData ? '' : ' no-data'}${key === todayKey ? ' is-today' : ''}" type="button" data-action="open-chart-day" data-day="${key}" ${hasData ? '' : 'disabled'} aria-label="${escapeHtml(accessibleDate)}: ${hasData ? `${progress.percent}% complete` : 'no tasks saved'}" title="${escapeHtml(accessibleDate)} · ${hasData ? `${progress.percent}%` : 'no tasks'}">
        <span class="week-bar-track"><i class="week-bar-fill" style="--bar-height:${height}%;--bar-min:${hasData ? '3px' : '0px'}"></i></span>
        <span class="week-value">${hasData ? `${progress.percent}%` : '·'}</span><span class="week-label">${escapeHtml(dayLabel)}</span>
      </button>`;
    }).join('');
    return `<section class="panel week-card" aria-label="Last seven days performance">
      <div class="week-heading"><h3>Last 7 days</h3><span>DAILY COMPLETION</span></div>
      <div class="week-chart">${bars}</div>
      <p class="week-footnote">A quiet day is shown as a dash, not a zero.</p>
    </section>`;
  }

  function renderToday() {
    const tasks = getTasks(todayKey);
    const progress = getDayProgress(tasks);
    const dayDate = dateFromKey(todayKey);
    const dayNumber = pad2(dayDate.getDate());
    const monthShort = formatDate(todayKey, { month: 'short' }).replace('.', '').toUpperCase();
    const locked = isReadOnly();
    return `<section class="day-intro" aria-label="Today's focus">
      <div class="intro-copy"><p class="eyebrow">YOUR DAY, YOUR PACE</p><h1>Make it <em>count.</em></h1><p>Small, intentional steps add up to a day well spent.</p></div>
      <div class="intro-art" aria-hidden="true"><span class="intro-orbit"></span><span class="intro-orbit orbit-second"></span><span class="intro-star"></span><span class="intro-core"><small>${escapeHtml(monthShort)}</small><strong>${dayNumber}</strong></span></div>
    </section>
    <div class="dashboard-grid">
      <section class="panel task-panel" aria-labelledby="tasks-heading">
        <div class="section-head"><div><p class="eyebrow">THE LIST</p><h2 id="tasks-heading">Today's tasks <span class="task-total">${String(tasks.length).padStart(2, '0')}</span></h2><p>One thing at a time. This list is yours to shape.</p></div><button class="add-task-button" type="button" data-action="open-add" ${locked ? 'disabled title="Restore or start fresh to edit saved data"' : ''}>${icon('plus')}<span>Add task</span><kbd>N</kbd></button></div>
        ${addFormOpen && !locked ? renderQuickAdd() : ''}
        ${tasks.length ? `<ul class="task-list">${tasks.map(renderTask).join('')}</ul>` : `<div class="empty-state"><div><span class="empty-state-icon">${icon('spark')}</span><h3>A little room to begin.</h3><p>Your list is clear. Add one meaningful task and build from there.</p><button class="add-task-button" type="button" data-action="open-add" ${locked ? 'disabled' : ''}>${icon('plus')}<span>Add your first task</span></button></div></div>`}
        ${tasks.length ? `<div class="task-panel-footer"><span><strong>${progress.completed}</strong> done <span aria-hidden="true">·</span> <strong>${progress.total - progress.completed}</strong> to go</span><span class="keyboard-tip">Quick add <kbd>N</kbd></span></div>` : ''}
      </section>
      <aside class="insights-column" aria-label="Daily statistics">
        ${renderProgressCard(progress)}
        ${renderStreakCard()}
        ${renderTotalsCard()}
        ${renderWeekCard()}
      </aside>
    </div>`;
  }

  function getHistorySummary() {
    const tasks = getAllTasks();
    const loggedDays = getLoggedDays();
    return {
      current: getCurrentStreak(),
      best: getBestStreak(),
      daysCompleted: loggedDays.filter((key) => isCompletedDay(key)).length,
      taskCount: tasks.length,
      completedCount: tasks.filter((task) => task.completed).length
    };
  }

  function renderHistoryStat(iconName, label, value, suffix = '') {
    return `<div class="history-stat"><span class="history-stat-icon">${icon(iconName)}</span><div><small>${label}</small><strong>${value}${suffix ? `<span> ${suffix}</span>` : ''}</strong></div></div>`;
  }

  function renderHistoryRows(days) {
    if (!days.length) {
      return `<div class="history-empty"><div><h3>Your story starts here.</h3><p>Completed days and open lists will appear here. Start with one small promise to yourself.</p><button class="solid-button" type="button" data-action="go-today">Go to today ${icon('arrow')}</button></div></div>`;
    }
    const grouped = new Map();
    for (const key of days) {
      const month = formatMonthYear(key);
      if (!grouped.has(month)) grouped.set(month, []);
      grouped.get(month).push(key);
    }
    let html = '';
    for (const [month, keys] of grouped.entries()) {
      html += `<h3 class="history-month">${escapeHtml(month)}</h3>`;
      html += keys.map((key) => {
        const tasks = getTasks(key);
        const progress = getDayProgress(tasks);
        const isSelected = key === selectedHistoryKey;
        const date = dateFromKey(key);
        const weekday = formatDate(key, { weekday: 'short' }).replace('.', '').slice(0, 3);
        return `<button class="history-row${isSelected ? ' is-selected' : ''}" type="button" data-action="select-history" data-day="${key}" aria-current="${isSelected ? 'true' : 'false'}">
          <span class="history-date-chip"><small>${escapeHtml(weekday)}</small><strong>${pad2(date.getDate())}</strong></span>
          <span class="history-row-center"><span class="history-row-title"><strong>${progress.completed} of ${progress.total} complete</strong><span>${progress.total} ${progress.total === 1 ? 'task' : 'tasks'}</span></span><span class="history-mini-track"><span style="width:${progress.percent}%"></span></span></span>
          <span class="history-row-percent">${progress.percent}%</span>
        </button>`;
      }).join('');
    }
    return html;
  }

  function renderHistoryDetail(key) {
    if (!key || !data.days[key] || !data.days[key].tasks.length) {
      return `<div class="history-empty"><div><h3>No saved list for this day.</h3><p>Only days where you add at least one task are included in your archive.</p></div></div>`;
    }
    const tasks = getTasks(key);
    const progress = getDayProgress(tasks);
    const status = progress.isComplete ? 'Day completed' : 'A day in progress';
    const taskRows = tasks.map((task) => `<li class="history-task${task.completed ? ' is-complete' : ''}">
      <span class="history-task-mark">${icon('check')}</span>
      <span><span class="history-task-name">${escapeHtml(task.title)}</span>${(task.category || task.priority) ? `<span class="history-task-meta">${getCategoryMarkup(task.category)}${getPriorityMarkup(task.priority)}</span>` : ''}${task.notes ? `<span class="history-task-note">${icon('note')}${escapeHtml(task.notes)}</span>` : ''}</span>
      <span class="history-task-status">${task.completed ? 'Done' : 'Open'}</span>
    </li>`).join('');
    return `<div class="history-detail-top"><div><p class="eyebrow">${escapeHtml(status)}</p><h2>${escapeHtml(formatDate(key, { weekday: 'long', month: 'long', day: 'numeric' }))}</h2><p>${progress.completed} of ${progress.total} tasks completed</p></div><span class="history-detail-pct">${progress.percent}%</span></div><ul class="history-task-list">${taskRows}</ul>`;
  }

  function renderHistory() {
    const days = getLoggedDays();
    if (selectedHistoryKey && !days.includes(selectedHistoryKey)) selectedHistoryKey = days[0] || '';
    if (!selectedHistoryKey && days.length) selectedHistoryKey = days[0];
    const summary = getHistorySummary();
    return `<section class="history-heading"><div><p class="eyebrow">A RECORD OF SHOWING UP</p><h1>Look how far <em>you've come.</em></h1><p>Every saved day is a small proof of follow-through. Select one to revisit the details.</p></div></section>
      <section class="history-summary" aria-label="History statistics">
        ${renderHistoryStat('flame', 'Current streak', summary.current, summary.current === 1 ? 'day' : 'days')}
        ${renderHistoryStat('calendar', 'Days completed', summary.daysCompleted, 'all time')}
        ${renderHistoryStat('checkCircle', 'Tasks completed', `${summary.completedCount}`, `of ${summary.taskCount}`)}
      </section>
      <div class="history-layout">
        <section class="panel history-list-panel" aria-label="Saved days"><div class="history-panel-head"><h2>Your days</h2><span>${days.length} ${days.length === 1 ? 'day' : 'days'} saved</span></div>${renderHistoryRows(days)}</section>
        <section class="panel history-detail-panel" aria-label="Selected day details">${renderHistoryDetail(selectedHistoryKey)}</section>
      </div>`;
  }

  function renderNotice() {
    if (loadIssue === 'corrupt') {
      return `<div class="notice"><div class="notice-copy">${icon('warning')}<div><strong>Saved data needs attention.</strong><p>The original has not been overwritten. Download a copy, or choose to start fresh.</p></div></div><div class="notice-actions"><button class="notice-button" type="button" data-action="download-recovery">Download original</button><button class="notice-button primary" type="button" data-action="open-reset">Start fresh</button></div></div>`;
    }
    if (loadIssue === 'unavailable' || storageWriteError) {
      const recoveryCopy = loadIssue === 'recovered' ? ' Some entries were repaired; download the original if you want a raw copy.' : '';
      const recoveryAction = loadIssue === 'recovered' ? '<button class="notice-button" type="button" data-action="download-recovery">Download original</button>' : '';
      return `<div class="notice"><div class="notice-copy">${icon('warning')}<div><strong>Changes could not be saved here.</strong><p>Your browser is blocking local storage. You can keep working in this tab, but export a backup before closing.${escapeHtml(recoveryCopy)}</p></div></div><div class="notice-actions">${recoveryAction}<button class="notice-button" type="button" data-action="export-data">Export data</button></div></div>`;
    }
    if (loadIssue === 'recovered') {
      const backupText = recoveryCopySaved ? 'A raw backup was kept in this browser.' : 'Download the original before making more changes.';
      return `<div class="notice"><div class="notice-copy">${icon('warning')}<div><strong>Some saved entries needed repair.</strong><p>Readable tasks were restored. ${escapeHtml(backupText)}</p></div></div><div class="notice-actions"><button class="notice-button" type="button" data-action="download-recovery">Download original</button><button class="notice-button" type="button" data-action="dismiss-recovery" aria-label="Dismiss recovery notice">Got it</button></div></div>`;
    }
    return '';
  }

  function renderChrome() {
    topbarDate.textContent = formatLongDate(todayKey);
    const statusText = loadIssue === 'corrupt' ? 'Recovery needed' : (loadIssue === 'unavailable' || storageWriteError ? 'Not saved' : 'Saved on this device');
    saveStatus.classList.toggle('is-warning', loadIssue === 'recovered' || loadIssue === 'corrupt');
    saveStatus.classList.toggle('is-error', loadIssue === 'unavailable' || storageWriteError);
    saveStatus.querySelector('span').textContent = statusText;
    noticeArea.innerHTML = renderNotice();
    const loggedCount = getLoggedDays().length;
    historyCount.textContent = loggedCount > 99 ? '99+' : String(loggedCount);
    document.querySelectorAll('.nav-link').forEach((button) => {
      const active = button.dataset.view === activeView;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    const currentEl = document.getElementById('sidebar-streak');
    const current = getCurrentStreak();
    if (currentEl) {
      currentEl.innerHTML = `<div class="sidebar-streak-top"><span>YOUR CURRENT RUN</span>${icon('flame')}</div><div class="sidebar-streak-count"><strong>${current}</strong><span>${current === 1 ? 'day' : 'days'}</span></div><small>${current ? 'A quiet kind of momentum.' : 'Start a streak with one good day.'}</small>`;
    }
  }

  function renderApp() {
    renderChrome();
    appPage.innerHTML = activeView === 'history' ? renderHistory() : renderToday();
  }

  function currentProgressPercent() {
    return getDayProgress(getTasks(todayKey)).percent;
  }

  function commitAndRender(previousPercent = null) {
    persistData();
    progressAnimationFrom = activeView === 'today' ? previousPercent : null;
    renderApp();
    progressAnimationFrom = null;
  }

  function openQuickAdd() {
    if (isReadOnly()) return;
    addFormOpen = true;
    activeView = 'today';
    renderApp();
    requestAnimationFrame(() => document.getElementById('new-task-title')?.focus());
  }

  function cancelQuickAdd() {
    addFormOpen = false;
    renderApp();
  }

  function addTask(form) {
    if (isReadOnly()) return;
    const formData = new FormData(form);
    const title = String(formData.get('title') || '').trim().slice(0, 160);
    if (!title) {
      document.getElementById('new-task-title')?.focus();
      return;
    }
    const previousPercent = currentProgressPercent();
    if (!data.days[todayKey]) data.days[todayKey] = { tasks: [] };
    const createdAt = new Date().toISOString();
    data.days[todayKey].tasks.push({
      id: createId(),
      title,
      category: cleanString(formData.get('category'), 50),
      priority: ['low', 'medium', 'high'].includes(formData.get('priority')) ? String(formData.get('priority')) : '',
      time: validTime(formData.get('time')) ? String(formData.get('time')) : '',
      notes: cleanString(formData.get('notes'), 2000),
      completed: false,
      createdAt,
      updatedAt: createdAt,
      completedAt: null
    });
    addFormOpen = false;
    commitAndRender(previousPercent);
    showToast('Task added to today.');
  }

  function findTask(dayKey, taskId) {
    const tasks = getTasks(dayKey);
    const index = tasks.findIndex((task) => task.id === taskId);
    return index < 0 ? null : { task: tasks[index], index, tasks };
  }

  function toggleTask(taskId) {
    if (isReadOnly()) return;
    const found = findTask(todayKey, taskId);
    if (!found) return;
    const previousPercent = currentProgressPercent();
    const wasComplete = getDayProgress(found.tasks).isComplete;
    found.task.completed = !found.task.completed;
    found.task.updatedAt = new Date().toISOString();
    found.task.completedAt = found.task.completed ? new Date().toISOString() : null;
    flashTaskId = found.task.completed ? found.task.id : '';
    if (flashTaskId) window.setTimeout(() => { flashTaskId = ''; }, 500);
    const nowComplete = getDayProgress(found.tasks).isComplete;
    commitAndRender(previousPercent);
    if (!wasComplete && nowComplete) showToast('Day completed. You showed up for yourself.');
  }

  function openDialog(markup, focusSelector = '') {
    dialogContent.innerHTML = markup;
    if (!dialog.open) dialog.showModal();
    if (focusSelector) requestAnimationFrame(() => dialogContent.querySelector(focusSelector)?.focus());
  }

  function closeDialog() {
    if (dialog.open) dialog.close();
    dialogContent.innerHTML = '';
  }

  function optionMarkup(value, current, label) {
    return `<option value="${value}"${value === current ? ' selected' : ''}>${label}</option>`;
  }

  function openEditDialog(taskId) {
    if (isReadOnly()) return;
    const found = findTask(todayKey, taskId);
    if (!found) return;
    const task = found.task;
    const title = escapeHtml(task.title);
    openDialog(`<form class="dialog-form" id="edit-task-form" data-id="${escapeHtml(task.id)}">
      <div class="dialog-head"><div><p class="eyebrow">A SMALL ADJUSTMENT</p><h2 id="dialog-title">Edit task</h2><p class="dialog-subtitle">Plans can change. Your progress stays yours.</p></div><button class="dialog-close" type="button" data-action="close-dialog" aria-label="Close">${icon('close')}</button></div>
      <label class="field"><span>Task name</span><input name="title" type="text" maxlength="160" required value="${title}"></label>
      <div class="dialog-fields-grid"><label class="field"><span>Category · optional</span><input name="category" type="text" maxlength="50" value="${escapeHtml(task.category)}" placeholder="Study, health…"></label><label class="field"><span>Priority</span><select name="priority">${optionMarkup('', task.priority, 'None')}${optionMarkup('low', task.priority, 'Low')}${optionMarkup('medium', task.priority, 'Medium')}${optionMarkup('high', task.priority, 'High')}</select></label></div>
      <div class="dialog-fields-grid"><label class="field"><span>Time · optional</span><input name="time" type="time" value="${escapeHtml(task.time)}"></label><span></span></div>
      <label class="field"><span>Note · optional</span><textarea name="notes" maxlength="2000" rows="3" placeholder="A small reminder for later…">${escapeHtml(task.notes)}</textarea></label>
      <div class="dialog-form-footer"><button class="danger-button" type="button" data-action="delete-task-dialog" data-id="${escapeHtml(task.id)}">${icon('trash')} Delete task</button><div class="dialog-form-footer-right"><button class="subtle-button" type="button" data-action="close-dialog">Cancel</button><button class="solid-button" type="submit">Save changes ${icon('arrow')}</button></div></div>
    </form>`, 'input[name="title"]');
  }

  function deleteTask(taskId) {
    if (isReadOnly()) return;
    const found = findTask(todayKey, taskId);
    if (!found) return;
    const previousPercent = currentProgressPercent();
    const [removed] = found.tasks.splice(found.index, 1);
    undoRecord = { dayKey: todayKey, task: removed, index: found.index };
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = window.setTimeout(() => { undoRecord = null; }, 6500);
    closeDialog();
    commitAndRender(previousPercent);
    showToast('Task removed.', 'Undo');
  }

  function undoDelete() {
    if (!undoRecord) return;
    const record = undoRecord;
    const previousPercent = record.dayKey === todayKey ? currentProgressPercent() : null;
    if (!data.days[record.dayKey]) data.days[record.dayKey] = { tasks: [] };
    data.days[record.dayKey].tasks.splice(Math.min(record.index, data.days[record.dayKey].tasks.length), 0, record.task);
    undoRecord = null;
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = null;
    commitAndRender(previousPercent);
    showToast('Task restored.');
  }

  function showToast(message, actionLabel = '') {
    if (toastTimer) clearTimeout(toastTimer);
    toastRegion.innerHTML = `<div class="toast" role="status"><span class="toast-message">${icon('checkCircle')}<span>${escapeHtml(message)}</span></span>${actionLabel ? `<button class="toast-action" type="button" data-action="undo-delete">${escapeHtml(actionLabel)}</button>` : ''}</div>`;
    toastTimer = window.setTimeout(() => {
      const toast = toastRegion.querySelector('.toast');
      if (!toast) return;
      toast.classList.add('is-leaving');
      window.setTimeout(() => { if (toast.isConnected) toast.remove(); }, 200);
    }, actionLabel ? 6500 : 2600);
  }

  function exportPayload() {
    return { app: 'Dayform', schemaVersion: 1, exportedAt: new Date().toISOString(), days: data.days };
  }

  function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportData() {
    const json = JSON.stringify(exportPayload(), null, 2);
    downloadBlob(json, `dayform-backup-${todayKey}.json`, 'application/json');
    showToast('Your JSON backup is ready.');
  }

  function downloadRecovery() {
    let raw = rawRecoveryText;
    if (!raw) {
      try { raw = localStorage.getItem(RECOVERY_KEY) || ''; } catch (error) { raw = ''; }
    }
    if (!raw) {
      showToast('No original backup is available in this tab.');
      return;
    }
    downloadBlob(raw, `dayform-original-recovery-${todayKey}.json`, 'application/json');
    showToast('Original saved data downloaded.');
  }

  function openImportPicker() {
    fileInput.value = '';
    fileInput.click();
  }

  async function readImportFile(file) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      showToast('That file is too large to import (8 MB maximum).');
      return;
    }
    try {
      const text = await file.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch (error) { throw new Error('This file is not valid JSON.'); }
      const result = normalizeData(parsed);
      if (result.fatal) throw new Error(result.reason || 'This file is not a Dayform backup.');
      pendingImport = result.data;
      pendingImportRecovered = result.recovered;
      pendingImportRawText = result.recovered ? text : '';
      const caution = result.recovered
        ? 'Some invalid entries will be skipped; readable days can still be restored.'
        : 'This will replace every saved day on this device.';
      openDialog(`<div class="dialog-head"><div><p class="eyebrow">RESTORE FROM BACKUP</p><h2 id="dialog-title">Replace saved data?</h2><p class="dialog-subtitle">${escapeHtml(file.name)} · ${Object.keys(result.data.days).length} days found</p></div><button class="dialog-close" type="button" data-action="close-dialog" aria-label="Close">${icon('close')}</button></div><p class="dialog-message">Import restores your tasks and completion history from this file. <strong>It replaces the data currently saved in this browser.</strong></p><div class="dialog-callout">${escapeHtml(caution)} For extra safety, export your current data first.</div><div class="dialog-actions"><button class="subtle-button" type="button" data-action="cancel-import">Keep current data</button><button class="solid-button" type="button" data-action="confirm-import">Replace &amp; import ${icon('arrow')}</button></div>`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not read this backup.');
    } finally {
      fileInput.value = '';
    }
  }

  function confirmImport() {
    if (!pendingImport) return;
    const importHadRecovery = pendingImportRecovered;
    const importedRawText = pendingImportRawText;
    data = pendingImport;
    pendingImport = null;
    loadIssue = importHadRecovery ? 'recovered' : '';
    pendingImportRecovered = false;
    pendingImportRawText = '';
    storageWriteError = false;
    rawRecoveryText = importHadRecovery ? importedRawText : '';
    recoveryCopySaved = false;
    if (rawRecoveryText) {
      try {
        localStorage.setItem(RECOVERY_KEY, rawRecoveryText);
        recoveryCopySaved = true;
      } catch (error) { recoveryCopySaved = false; }
    }
    activeView = 'today';
    selectedHistoryKey = '';
    addFormOpen = false;
    closeDialog();
    persistData();
    renderApp();
    showToast('Your data has been restored.');
  }

  function openResetDialog() {
    openDialog(`<div class="dialog-head"><div><p class="eyebrow">START OVER</p><h2 id="dialog-title">Clear this saved file?</h2><p class="dialog-subtitle">Your damaged original can be downloaded first.</p></div><button class="dialog-close" type="button" data-action="close-dialog" aria-label="Close">${icon('close')}</button></div><p class="dialog-message">This will replace the unreadable data in this browser with a clean Dayform workspace. It cannot be undone unless you saved the original backup.</p><div class="dialog-callout">${recoveryCopySaved ? 'A recovery copy has been kept in this browser.' : 'We recommend downloading the original before continuing.'}</div><div class="dialog-actions"><button class="subtle-button" type="button" data-action="close-dialog">Cancel</button><button class="solid-button" type="button" data-action="confirm-reset">Start fresh</button></div>`);
  }

  function confirmReset() {
    if (rawRecoveryText) {
      try {
        localStorage.setItem(RECOVERY_KEY, rawRecoveryText);
        recoveryCopySaved = true;
      } catch (error) { recoveryCopySaved = false; }
    }
    data = emptyData();
    loadIssue = '';
    storageWriteError = false;
    rawRecoveryText = '';
    activeView = 'today';
    selectedHistoryKey = '';
    closeDialog();
    persistData();
    renderApp();
    showToast('A fresh workspace is ready.');
  }

  function setView(view) {
    if (!['today', 'history'].includes(view)) return;
    activeView = view;
    addFormOpen = false;
    if (view === 'history') {
      const days = getLoggedDays();
      if (!days.includes(selectedHistoryKey)) selectedHistoryKey = days[0] || '';
    }
    renderApp();
    appPage.focus({ preventScroll: true });
  }

  function openHistoryDay(key) {
    if (!getLoggedDays().includes(key)) return;
    selectedHistoryKey = key;
    activeView = 'history';
    addFormOpen = false;
    renderApp();
    appPage.focus({ preventScroll: true });
  }

  function checkForDateChange() {
    const currentKey = localDateKey(new Date());
    if (currentKey !== todayKey) {
      if (dialog.open && dialogContent.querySelector('#edit-task-form')) closeDialog();
      todayKey = currentKey;
      addFormOpen = false;
      renderApp();
      if (activeView === 'today') showToast('A new day is ready. Yesterday is safe in History.');
    }
    scheduleNextMidnight();
  }

  function scheduleNextMidnight() {
    if (midnightTimer) clearTimeout(midnightTimer);
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    const delay = Math.max(250, nextMidnight.getTime() - now.getTime() + 100);
    midnightTimer = window.setTimeout(checkForDateChange, delay);
  }

  function updateTask(taskId, form) {
    if (isReadOnly()) return;
    const found = findTask(todayKey, taskId);
    if (!found) return;
    const formData = new FormData(form);
    const title = String(formData.get('title') || '').trim().slice(0, 160);
    if (!title) {
      form.querySelector('input[name="title"]')?.focus();
      return;
    }
    const previousPercent = currentProgressPercent();
    found.task.title = title;
    found.task.category = cleanString(formData.get('category'), 50);
    found.task.priority = ['low', 'medium', 'high'].includes(formData.get('priority')) ? String(formData.get('priority')) : '';
    found.task.time = validTime(formData.get('time')) ? String(formData.get('time')) : '';
    found.task.notes = cleanString(formData.get('notes'), 2000);
    found.task.updatedAt = new Date().toISOString();
    closeDialog();
    commitAndRender(previousPercent);
    showToast('Task updated.');
  }

  document.addEventListener('click', (event) => {
    const control = event.target.closest('[data-action]');
    if (!control) return;
    const action = control.dataset.action;
    switch (action) {
      case 'set-view': setView(control.dataset.view); break;
      case 'go-today': setView('today'); break;
      case 'open-add': openQuickAdd(); break;
      case 'cancel-add': cancelQuickAdd(); break;
      case 'toggle-task': toggleTask(control.dataset.id); break;
      case 'edit-task': openEditDialog(control.dataset.id); break;
      case 'delete-task': deleteTask(control.dataset.id); break;
      case 'delete-task-dialog': deleteTask(control.dataset.id); break;
      case 'undo-delete': undoDelete(); break;
      case 'export-data': exportData(); break;
      case 'choose-import': openImportPicker(); break;
      case 'confirm-import': confirmImport(); break;
      case 'cancel-import': pendingImport = null; pendingImportRecovered = false; pendingImportRawText = ''; closeDialog(); break;
      case 'open-reset': openResetDialog(); break;
      case 'confirm-reset': confirmReset(); break;
      case 'download-recovery': downloadRecovery(); break;
      case 'dismiss-recovery': loadIssue = ''; rawRecoveryText = ''; renderApp(); break;
      case 'close-dialog': pendingImport = null; pendingImportRecovered = false; pendingImportRawText = ''; closeDialog(); break;
      case 'select-history': openHistoryDay(control.dataset.day); break;
      case 'open-chart-day': openHistoryDay(control.dataset.day); break;
      default: break;
    }
  });

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (form.id === 'quick-add-form') {
      event.preventDefault();
      addTask(form);
    } else if (form.id === 'edit-task-form') {
      event.preventDefault();
      updateTask(form.dataset.id, form);
    }
  });

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const inTextField = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    if (!inTextField && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'n' && activeView === 'today' && !dialog.open) {
      event.preventDefault();
      openQuickAdd();
    }
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) readImportFile(file);
  });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      pendingImport = null;
      pendingImportRecovered = false;
      pendingImportRawText = '';
      closeDialog();
    }
  });
  dialog.addEventListener('cancel', () => {
    pendingImport = null;
    pendingImportRecovered = false;
    pendingImportRawText = '';
  });
  dialog.addEventListener('close', () => {
    dialogContent.innerHTML = '';
  });

  window.addEventListener('focus', checkForDateChange);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForDateChange();
  });
  window.addEventListener('pageshow', checkForDateChange);
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    if (event.newValue === null) {
      data = emptyData();
      loadIssue = '';
      storageWriteError = false;
      renderApp();
      showToast('Saved data was cleared in another tab.');
      return;
    }
    try {
      const result = normalizeData(JSON.parse(event.newValue));
      if (!result.fatal) {
        data = result.data;
        loadIssue = result.recovered ? 'recovered' : '';
        renderApp();
        showToast('Updated from another open tab.');
      }
    } catch (error) {
      // Leave the current in-memory copy untouched if another tab writes invalid data.
    }
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {
        // The app still works normally if offline caching is unavailable (for example, on file://).
      });
    });
  }

  loadInitialData();
  renderApp();
  scheduleNextMidnight();
})();

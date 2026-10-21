"use strict";

(() => {
  const studentList = document.querySelector("[data-student-list]");
  const tableState = document.querySelector("[data-table-state]");
  const adminMessage = document.querySelector("[data-admin-message]");
  const inboxList = document.querySelector("[data-inbox-list]");
  const inboxState = document.querySelector("[data-inbox-state]");
  const inboxMessage = document.querySelector("[data-inbox-message]");
  const studentDetail = document.querySelector("[data-student-detail]");
  const studentBrowse = document.querySelector("[data-student-browse]");
  const scheduleList = document.querySelector("[data-schedule-list]");
  const scheduleState = document.querySelector("[data-schedule-state]");
  const scheduleMessage = document.querySelector("[data-schedule-message]");
  const settingsList = document.querySelector("[data-settings-list]");
  const settingsState = document.querySelector("[data-settings-state]");
  const studentDialog = document.querySelector("[data-student-dialog]");
  const studentForm = document.querySelector("[data-student-form]");
  const linkDialog = document.querySelector("[data-link-dialog]");
  const generatedLink = document.querySelector("[data-generated-link]");
  const studyPlanDialog = document.querySelector("[data-study-plan-dialog]");
  const studyPlanForm = document.querySelector("[data-study-plan-form]");
  const testBrowser = document.querySelector("[data-test-browser]");
  const testList = document.querySelector("[data-test-list]");
  const testEditor = document.querySelector("[data-test-editor]");
  const testEditorForm = document.querySelector("[data-test-editor-form]");
  const materialList = document.querySelector("[data-material-list]");
  const materialState = document.querySelector("[data-material-state]");
  const materialDialog = document.querySelector("[data-material-dialog]");
  const materialForm = document.querySelector("[data-material-form]");
  const conversationDialog = document.querySelector("[data-conversation-dialog]");
  const conversationForm = document.querySelector("[data-conversation-form]");
  const feedbackRenderer = window.EGE_FEEDBACK_RENDERER;

  let students = [];
  let submissions = [];
  let inboxItems = [];
  let inboxCounts = { unseenTests: 0, unseenWorks: 0, unreadMessages: 0, total: 0 };
  let activeInboxKind = "all";
  let scheduleEvents = [];
  let courseTopics = [];
  let courseSections = [];
  let activePlanStudent = null;
  let activeStudyPlan = null;
  let activeStudentDetails = null;
  let previewSignature = null;
  let adminTests = [];
  let activeAdminTest = null;
  let materials = [];
  let activeStudentTab = "overview";
  let activeConversation = null;

  const statusNames = {
    pending_activation: "Ожидает активации", active: "Активен",
    blocked: "Заблокирован", archived: "В архиве",
  };
  const submissionStatusNames = {
    submitted: "Новая", in_review: "На проверке",
    needs_revision: "На доработке", accepted: "Принята",
  };
  const eventTypeNames = {
    lesson: "Занятие", test_deadline: "Тест",
    homework_deadline: "Вторая часть", thematic_mock: "Пробник",
  };
  const materialStatusNames = { published: "Опубликован", hidden: "Скрыт", archived: "В архиве" };
  const materialScopeNames = { course: "Весь курс", section: "Раздел", topic: "Тема" };
  let sectionNames = {
    human_society: "Человек и общество / духовная культура",
    social_relations: "Социальные отношения", economics: "Экономика", politics: "Политика", law: "Право",
  };

  function escapeHtml(value) {
    const span = document.createElement("span");
    span.textContent = value == null ? "" : String(value);
    return span.innerHTML;
  }

  function dateTime(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }

  function dateOnly(value) {
    if (!value) return "—";
    const raw = String(value).slice(0, 10);
    const [year, month, day] = raw.split("-").map(Number);
    return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(new Date(year, month - 1, day, 12));
  }

  function rawDate(value) { return value ? String(value).slice(0, 10) : ""; }

  function todayMoscow() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
    return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} МБ`;
  }

  function conversationFileMime(file) {
    const extension = file.name.split(".").pop()?.toLowerCase();
    return ({
      pdf: "application/pdf",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
    })[extension] || file.type || "application/octet-stream";
  }

  function conversationTextHeaders(text) {
    if (!text) return {};
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const encoded = btoa(binary);
    const parts = encoded.match(/.{1,7000}/g) || [];
    if (parts.length > 4) throw new Error("Для сообщения с файлом сократите текст.");
    return Object.fromEntries([
      ["x-message-text-parts", String(parts.length)],
      ...parts.map((part, index) => [`x-message-text-${index + 1}`, part]),
    ]);
  }

  function conversationAttachmentMarkup(attachment) {
    return `<div class="conversation-attachment"><span><strong>${escapeHtml(feedbackRenderer.displayFilename(attachment.originalFilename))}</strong><small>${formatBytes(attachment.sizeBytes)}</small></span><a class="action-button" href="${escapeHtml(attachment.downloadUrl)}">Скачать</a></div>`;
  }

  function conversationAttachmentPickerMarkup(id) {
    return `<div class="conversation-attachment-control"><label class="conversation-file-button" for="${id}">Прикрепить файл<input id="${id}" name="attachment" type="file" accept=".pdf,.docx,.jpg,.jpeg,.png"></label><div class="conversation-selected-file" data-conversation-selected-file hidden><span><strong data-conversation-file-name></strong><small data-conversation-file-size></small></span><button type="button" data-remove-conversation-file>Убрать</button></div></div>`;
  }

  function resetConversationAttachment(form) {
    const input = form.elements.attachment;
    if (input) input.value = "";
    const selected = form.querySelector("[data-conversation-selected-file]");
    if (selected) selected.hidden = true;
    const name = form.querySelector("[data-conversation-file-name]");
    const size = form.querySelector("[data-conversation-file-size]");
    if (name) name.textContent = "";
    if (size) size.textContent = "";
  }

  function showConversationAttachment(form, status) {
    const file = form.elements.attachment?.files[0];
    if (!file) {
      resetConversationAttachment(form);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      status.textContent = "Файл должен быть не больше 10 МБ.";
      resetConversationAttachment(form);
      return;
    }
    form.querySelector("[data-conversation-file-name]").textContent = file.name;
    form.querySelector("[data-conversation-file-size]").textContent = formatBytes(file.size);
    form.querySelector("[data-conversation-selected-file]").hidden = false;
  }

  async function sendConversationMessage(type, id, body, file) {
    const route = `/conversations/${encodeURIComponent(type)}/${encodeURIComponent(id)}/messages`;
    if (!file) return api(route, { method: "POST", body: JSON.stringify({ body }) });
    return api(`${route}/file`, {
      method: "POST",
      headers: {
        "content-type": conversationFileMime(file),
        "x-file-name": encodeURIComponent(file.name),
        ...conversationTextHeaders(body),
      },
      body: file,
    });
  }

  function topicName(id) {
    if (!id) return "—";
    const topic = courseTopics.find((item) => item.id === id);
    return topic ? `Тема №${String(topic.lesson).padStart(2, "0")} — ${topic.title}` : id;
  }

  async function api(path, options = {}) {
    const response = await fetch(`/api/admin${path}`, {
      credentials: "same-origin",
      ...options,
      headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) },
    });
    const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error?.message || "Не удалось выполнить действие");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function renderInboxSummary() {
    const counts = {
      all: Number(inboxCounts.total || 0),
      test: Number(inboxCounts.unseenTests || 0),
      work: Number(inboxCounts.unseenWorks || 0),
      message: Number(inboxCounts.unreadMessages || 0),
    };
    document.querySelectorAll("[data-inbox-kind]").forEach((button) => {
      const selected = button.dataset.inboxKind === activeInboxKind;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
      button.querySelector("[data-inbox-filter-count]").textContent = String(counts[button.dataset.inboxKind] || 0);
    });
    const badge = document.querySelector("[data-inbox-count]");
    const total = counts.all;
    badge.textContent = String(total);
    badge.hidden = !total;
  }

  function conversationKind(type) {
    if (type === "homework") return "ДЗ второй части";
    if (type === "mock") return "Тематический пробник";
    return "Тест";
  }

  function updateFilterOptions() {
    const choices = students.filter((student) => student.status !== "archived")
      .map((student) => `<option value="${student.id}">${escapeHtml(student.name)}</option>`).join("");
    const select = document.querySelector("[data-schedule-filter='student']");
    const current = select.value;
    select.innerHTML = `<option value="">Все ученики</option>${choices}`;
    select.value = current;
  }

  function renderWorkInboxItem(activity) {
    const item = activity.submission;
    const title = item.type === "mock" ? (item.mock?.title || item.mockId) : topicName(item.topicId);
    const kind = item.type === "mock" ? "Тематический пробник" : "ДЗ второй части";
    return `<article class="submission-row unified-inbox-card unified-inbox-work" data-submission="${item.type}:${item.id}">
        <div>
          <p class="submission-kind">${escapeHtml(activity.label)}</p>
          <div class="submission-heading"><h2>${escapeHtml(item.studentName)}</h2><span class="status status-${item.status}">${submissionStatusNames[item.status] || escapeHtml(item.status)}</span></div>
          <p class="submission-meta">${escapeHtml(kind)} · ${escapeHtml(title)}<br>${dateTime(activity.occurredAt)} · версия ${item.fileRevision}</p>
        </div>
        <div>
          <div class="submission-file"><div><strong>${escapeHtml(feedbackRenderer.displayFilename(item.fileName))}</strong><span class="secondary-copy">${item.sizeBytes === null ? "Размер не указан" : formatBytes(item.sizeBytes)} · редакция ${item.fileRevision}</span></div>${item.downloadUrl ? `<a class="action-button" href="${escapeHtml(item.downloadUrl)}">Скачать</a>` : `<span class="secondary-copy">Файл не загружен</span>`}</div>
          <p class="submission-note"><strong>Комментарий ученика:</strong> ${escapeHtml(item.studentComment || "Без комментария")}</p>
          <div class="submission-conversation-actions"><button class="action-button" type="button" data-open-work-conversation="${item.type}:${item.id}">Открыть переписку</button></div>
        </div>
        <div class="submission-review">
          <label>Статус<select data-review-status><option value="in_review" ${item.status === "in_review" ? "selected" : ""}>На проверке</option><option value="needs_revision" ${item.status === "needs_revision" ? "selected" : ""}>Нужно исправить</option><option value="accepted" ${item.status === "accepted" ? "selected" : ""}>Принято</option></select></label>
          <label>Комментарий преподавателя<textarea data-review-comment maxlength="4000" placeholder="Что исправить или на что обратить внимание">${escapeHtml(item.teacherComment)}</textarea></label>
          <div class="submission-review-actions"><button class="primary-button" type="button" data-save-review>Сохранить проверку</button></div>
        </div>
      </article>`;
  }

  function renderTestInboxItem(item) {
    const score = item.score === null
      ? "Без автоматического балла"
      : `${item.score} / ${item.maxScore} · ${Math.round(item.percentage)}%`;
    return `<article class="unified-inbox-card unified-inbox-compact" data-inbox-item="${escapeHtml(item.id)}">
      <div class="unified-inbox-copy"><p class="submission-kind">${escapeHtml(item.label)}</p><h2>${escapeHtml(item.studentName)}</h2><p>${escapeHtml(item.sectionTitle || "Тест")} · ${escapeHtml(item.title)}</p><strong class="inbox-score">${escapeHtml(score)}</strong><span>${dateTime(item.occurredAt)} · попытка №${item.attemptNumber}</span>${item.unreadMessageCount ? `<span class="conversation-unread">Непрочитанных сообщений: ${item.unreadMessageCount}</span>` : ""}</div>
      <button class="action-button" type="button" data-open-inbox-attempt="${item.studentId}:${item.attemptId}">Посмотреть ответы</button>
    </article>`;
  }

  function renderMessageInboxItem(item) {
    const subject = item.title ? `${conversationKind(item.subjectType)} · ${item.title}` : conversationKind(item.subjectType);
    return `<article class="unified-inbox-card unified-inbox-compact" data-inbox-item="${escapeHtml(item.id)}">
      <div class="unified-inbox-copy"><p class="submission-kind">${escapeHtml(item.label)}</p><h2>${escapeHtml(item.studentName)}</h2><p>${escapeHtml(subject)}</p><span>${dateTime(item.occurredAt)}${item.unreadCount > 1 ? ` · сообщений: ${item.unreadCount}` : ""}</span><blockquote>${escapeHtml(item.preview)}</blockquote>${item.attachmentFilename ? `<span class="conversation-inbox-file">Файл: ${escapeHtml(feedbackRenderer.displayFilename(item.attachmentFilename))}</span>` : ""}</div>
      <button class="action-button" type="button" data-open-inbox-conversation="${item.subjectType}:${item.subjectId}:${item.studentId}">Открыть</button>
    </article>`;
  }

  function renderInbox() {
    const filtered = inboxItems.filter((item) => activeInboxKind === "all" || item.kind === activeInboxKind);
    renderInboxSummary();
    inboxState.hidden = Boolean(filtered.length);
    inboxState.textContent = inboxItems.length ? "В этой категории новых действий нет." : "Новых действий пока нет.";
    inboxList.innerHTML = filtered.map((item) => {
      if (item.kind === "test") return renderTestInboxItem(item);
      if (item.kind === "work") return renderWorkInboxItem(item);
      return renderMessageInboxItem(item);
    }).join("");
  }

  function activationNote(student) {
    if (student.status !== "pending_activation") return "";
    if (student.activationLinkStatus === "valid" && student.activationExpiresAt) return `<span class="activation-expiry">Ссылка действует до ${dateTime(student.activationExpiresAt)}</span>`;
    if (student.activationLinkStatus === "expired") return `<span class="activation-expiry is-expired">Срок ссылки истёк</span>`;
    return `<span class="activation-expiry">Нужна новая ссылка активации</span>`;
  }

  function renderStudents() {
    if (!students.length) {
      studentList.innerHTML = "";
      tableState.hidden = false;
      tableState.textContent = "Учеников пока нет";
      return;
    }
    tableState.hidden = true;
    const totalSteps = courseTopics.length * 2;
    studentList.innerHTML = students.filter((student) => student.status !== "archived").map((student) => `
      <tr>
        <td data-label="Ученик"><span class="student-name">${escapeHtml(student.name)}</span><span class="student-login">${escapeHtml(student.login)}</span></td>
        <td data-label="Статус"><span class="status status-${student.status}">${statusNames[student.status] || escapeHtml(student.status)}</span></td>
        <td data-label="Текущая тема">${escapeHtml(topicName(student.currentTopicId))}</td>
        <td data-label="Следующее занятие">${student.nextLesson ? `${dateOnly(student.nextLesson.date)}<span class="secondary-copy">часть ${student.nextLesson.lessonPart}</span>` : "—"}</td>
        <td data-label="Прогресс"><span class="progress-copy">${student.completedSteps} / ${totalSteps || "—"}</span></td>
        <td data-label="Ждут проверки">${student.waitingReviewCount}</td>
        <td data-label="Карточка"><button class="action-button" type="button" data-open-student="${student.id}">Открыть</button></td>
      </tr>`).join("");
  }

  function accountActions(student) {
    if (student.status === "archived") return "";
    const link = student.status === "pending_activation"
      ? `<button class="action-button" type="button" data-account-action="activation" data-id="${student.id}">Новая ссылка активации</button>`
      : student.status === "active"
        ? `<button class="action-button" type="button" data-account-action="reset" data-id="${student.id}">Смена пароля</button>` : "";
    const access = student.status === "blocked"
      ? `<button class="action-button" type="button" data-account-action="unblock" data-id="${student.id}">Разблокировать</button>`
      : `<button class="action-button" type="button" data-account-action="block" data-id="${student.id}">Заблокировать</button>`;
    return `<button class="action-button" type="button" data-account-action="edit" data-id="${student.id}">Изменить</button>${link}${access}<button class="action-button danger" type="button" data-account-action="archive" data-id="${student.id}">В архив</button>`;
  }

  function renderSettings() {
    const visible = students.filter((student) => student.status !== "archived");
    settingsState.hidden = Boolean(visible.length);
    settingsState.textContent = "Аккаунтов пока нет";
    settingsList.innerHTML = visible.map((student) => `
      <article class="settings-row"><div><span class="student-name">${escapeHtml(student.name)}</span><span class="student-login">${escapeHtml(student.login)}</span>${activationNote(student)}</div><div><span class="status status-${student.status}">${statusNames[student.status] || escapeHtml(student.status)}</span></div><div class="settings-actions">${accountActions(student)}</div></article>`).join("");
  }

  function detailWorks(works) {
    if (!works.length) return `<p class="detail-empty">Работ пока нет.</p>`;
    return `<div class="detail-list">${works.map((work) => `<div class="detail-line"><div><strong>${work.type === "mock" ? escapeHtml(work.mock?.title || work.mockId) : escapeHtml(topicName(work.topicId))}</strong><span class="secondary-copy">${dateTime(work.updatedAt)} · редакция ${work.fileRevision}</span></div><span class="status status-${work.status}">${submissionStatusNames[work.status] || escapeHtml(work.status)}</span><button class="action-button" type="button" data-open-work-conversation="${work.type}:${work.id}">Переписка</button></div>`).join("")}</div>`;
  }

  function renderStudentDetail(payload) {
    activeStudentDetails = payload;
    const { student } = payload;
    studentBrowse.hidden = true;
    studentDetail.hidden = false;
    studentDetail.innerHTML = `
      <div class="student-detail-header"><div><button class="action-button" type="button" data-close-student>← К списку</button><h2>${escapeHtml(student.name)}</h2><span class="student-login">${escapeHtml(student.login)}</span></div><span class="status status-${student.status}">${statusNames[student.status] || escapeHtml(student.status)}</span></div>
      <nav class="student-card-tabs" aria-label="Карточка ученика"><button type="button" data-student-tab="overview">Обзор</button><button type="button" data-student-tab="plan">Учебный план</button><button type="button" data-student-tab="tests">Тесты</button><button type="button" data-student-tab="works">Работы</button></nav>
      <div data-student-pane></div>`;
    renderStudentPane(activeStudentTab);
    studentDetail.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderStudentPane(name) {
    if (!activeStudentDetails) return;
    activeStudentTab = name;
    studentDetail.querySelectorAll("[data-student-tab]").forEach((button) => button.classList.toggle("is-active", button.dataset.studentTab === name));
    const { student, studyPlan, works, tests, progress } = activeStudentDetails;
    const pane = studentDetail.querySelector("[data-student-pane]");
    if (name === "overview") {
      const waiting = works.filter((item) => ["submitted", "in_review"].includes(item.status)).length;
      const recent = [
        ...tests.map((item) => ({ at: item.submittedAt, text: `Тест · ${item.title}` })),
        ...works.map((item) => ({ at: item.updatedAt, text: item.type === "mock" ? `Пробник · ${item.mock?.title || item.mockId}` : `Вторая часть · ${topicName(item.topicId)}` })),
      ].sort((left, right) => new Date(right.at) - new Date(left.at)).slice(0, 4);
      pane.innerHTML = `<div class="student-detail-grid"><section class="detail-block"><h3>Прогресс</h3><p><strong>${progress.filter((item) => item.testCompletedAt).length}</strong> тестов выполнено</p><p><strong>${progress.filter((item) => item.homeworkSubmittedAt).length}</strong> заданий второй части отправлено</p><p><strong>${waiting}</strong> работ ждут проверки</p></section><section class="detail-block"><h3>Сейчас в плане</h3><p><strong>${studyPlan.nextLesson ? escapeHtml(topicName(studyPlan.nextLesson.topicId)) : "Тема не определена"}</strong></p><p>Следующее занятие: ${studyPlan.nextLesson ? dateOnly(studyPlan.nextLesson.scheduledDate) : "не запланировано"}</p></section><section class="detail-block detail-block-wide"><h3>Последние действия</h3>${recent.length ? `<div class="detail-list">${recent.map((item) => `<div class="detail-line"><strong>${escapeHtml(item.text)}</strong><span class="secondary-copy">${dateTime(item.at)}</span></div>`).join("")}</div>` : `<p class="detail-empty">Действий пока нет.</p>`}</section><section class="detail-block detail-block-wide"><h3>Аккаунт</h3><div class="detail-actions">${accountActions(student)}</div></section></div>`;
      return;
    }
    if (name === "plan") {
      pane.innerHTML = `<section class="detail-block"><h3>Учебный план</h3>${studyPlan.plan ? `<p>Старт: ${escapeHtml(topicName(studyPlan.plan.startTopicId))}</p><p>Следующее занятие: ${studyPlan.nextLesson ? `${dateOnly(studyPlan.nextLesson.scheduledDate)} · ${escapeHtml(studyPlan.nextLesson.topic?.title || studyPlan.nextLesson.topicId)}` : "не запланировано"}</p>` : `<p class="detail-empty">План пока не настроен.</p>`}<button class="action-button" type="button" data-open-study-plan="${student.id}">Настроить план</button></section>`;
      return;
    }
    if (name === "works") {
      pane.innerHTML = `<section class="detail-block"><h3>Отправленные работы</h3>${detailWorks(works)}</section>`;
      return;
    }
    const sections = [...new Set(tests.map((attempt) => attempt.sectionId).filter(Boolean))];
    pane.innerHTML = `<section class="detail-block student-tests"><div class="student-tests-heading"><h3>Попытки тестов</h3><div class="student-test-filters"><label>Раздел<select data-attempt-filter="section"><option value="">Все разделы</option>${sections.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(sectionNames[id] || id)}</option>`).join("")}</select></label><label>Тема<select data-attempt-filter="topic"><option value="">Все темы</option>${[...new Map(tests.map((attempt) => [attempt.topicId, attempt.title])).entries()].map(([id, title]) => `<option value="${escapeHtml(id)}">${escapeHtml(title)}</option>`).join("")}</select></label></div></div><div data-attempt-list></div></section>`;
    renderAttemptList();
  }

  function renderAttemptList() {
    const target = studentDetail.querySelector("[data-attempt-list]");
    if (!target || !activeStudentDetails) return;
    const section = studentDetail.querySelector("[data-attempt-filter='section']")?.value || "";
    const topic = studentDetail.querySelector("[data-attempt-filter='topic']")?.value || "";
    const attempts = activeStudentDetails.tests.filter((item) => (!section || item.sectionId === section) && (!topic || item.topicId === topic));
    target.innerHTML = attempts.length ? `<div class="attempt-list">${attempts.map((attempt) => `<article class="attempt-row"><div><strong>${escapeHtml(attempt.title)}</strong><span class="secondary-copy">${escapeHtml(topicName(attempt.topicId))}</span><span class="secondary-copy">${dateTime(attempt.submittedAt)} · попытка №${attempt.attemptNumber}</span></div><strong>${attempt.score === null ? "Без автоматического балла" : `${attempt.score} / ${attempt.maxScore} · ${Math.round(attempt.percentage)}%`}</strong><button class="action-button" type="button" data-open-attempt="${attempt.id}">Посмотреть ответы</button></article>`).join("")}</div>` : `<p class="detail-empty">По выбранным фильтрам попыток нет.</p>`;
  }

  function conversationMarkup(conversation) {
    const messages = conversation?.messages || [];
    if (!messages.length) return '<p class="detail-empty">Сообщений пока нет.</p>';
    return messages.map((message) => `<article class="conversation-message ${message.sender === "teacher" ? "is-teacher" : "is-student"}">
      <header><strong>${message.sender === "teacher" ? "Вы" : escapeHtml(message.author || "Ученик")}</strong><time>${dateTime(message.createdAt)}</time></header>
      ${message.text ? (message.sender === "teacher" ? `<div class="feedback-markdown">${feedbackRenderer.formatFeedbackMarkdown(message.text)}</div>` : `<p>${escapeHtml(message.text)}</p>`) : ""}
      ${(message.attachments || []).map(conversationAttachmentMarkup).join("")}
    </article>`).join("");
  }

  function conversationContext(type, id) {
    const submission = submissions.find((item) => item.type === type && item.id === String(id));
    if (!submission) return `<strong>${escapeHtml(conversationKind(type))}</strong>`;
    const title = type === "mock" ? (submission.mock?.title || submission.mockId) : topicName(submission.topicId);
    return `<strong>${escapeHtml(submission.studentName)} · ${escapeHtml(title)}</strong><br>${escapeHtml(feedbackRenderer.displayFilename(submission.fileName || "Файл не загружен"))} · ${submissionStatusNames[submission.status] || escapeHtml(submission.status)}`;
  }

  async function reloadInbox() {
    const payload = await api("/inbox");
    inboxItems = payload.items || [];
    submissions = payload.submissions || [];
    inboxCounts = payload.counts || {};
    renderInbox();
  }

  async function readConversation(type, id) {
    await api(`/conversations/${encodeURIComponent(type)}/${encodeURIComponent(id)}/read`, {
      method: "POST", body: JSON.stringify({}),
    });
    await reloadInbox();
  }

  async function openAdminConversation(type, id, title = null) {
    activeConversation = { type, id: String(id) };
    document.querySelector("[data-conversation-title]").textContent = title || conversationKind(type);
    document.querySelector("[data-conversation-context]").innerHTML = conversationContext(type, id);
    document.querySelector("[data-conversation-history]").innerHTML = '<p class="detail-empty">Загружаем переписку…</p>';
    document.querySelector("[data-conversation-message]").textContent = "";
    conversationForm.reset();
    resetConversationAttachment(conversationForm);
    if (!conversationDialog.open) conversationDialog.showModal();
    try {
      const payload = await api(`/conversations/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
      document.querySelector("[data-conversation-history]").innerHTML = conversationMarkup(payload.conversation);
      document.querySelector("[data-conversation-history]").scrollTop = document.querySelector("[data-conversation-history]").scrollHeight;
      if (payload.conversation.unreadCount) await readConversation(type, id);
    } catch (error) {
      document.querySelector("[data-conversation-history]").innerHTML = `<p class="detail-empty">${escapeHtml(error.message)}</p>`;
    }
  }

  function attemptConversationMarkup(conversation, attemptId) {
    return `<section class="attempt-conversation" data-attempt-conversation="${attemptId}"><h3>Переписка по попытке</h3><div class="conversation-history">${conversationMarkup(conversation)}</div><form class="conversation-reply-form" data-inline-conversation-form="test_attempt:${attemptId}"><label>Ответ ученику<textarea name="body" maxlength="6000" placeholder="Напишите ответ"></textarea></label>${conversationAttachmentPickerMarkup(`attempt-conversation-file-${attemptId}`)}<p class="form-message" data-inline-message role="status" aria-live="polite"></p><button class="primary-button" type="submit">Ответить ученику</button></form></section>`;
  }

  async function openAttempt(attemptId) {
    const pane = studentDetail.querySelector("[data-student-pane]");
    pane.innerHTML = `<div class="table-state">Загружаем ответы…</div>`;
    try {
      const [payload, conversationPayload] = await Promise.all([
        api(`/students/${activeStudentDetails.student.id}/test-attempts/${attemptId}`),
        api(`/conversations/test_attempt/${attemptId}`),
      ]);
      const attempt = payload.attempt;
      pane.innerHTML = `<section class="attempt-detail"><button class="action-button" type="button" data-back-to-attempts>← Ко всем попыткам</button><div class="attempt-detail-heading"><div><h3>${escapeHtml(attempt.title)}</h3><p>${dateTime(attempt.submittedAt)} · попытка №${attempt.attemptNumber} · версия ${attempt.version || "не сохранена"}</p></div><strong>${attempt.score === null ? "Без автоматического балла" : `${attempt.score} / ${attempt.maxScore} · ${Math.round(attempt.percentage)}%`}</strong></div>${attempt.detailsAvailable ? `<div class="attempt-questions">${attempt.questions.map((question) => `<article class="attempt-question ${question.isCorrect === true ? "is-correct" : question.isCorrect === false ? "is-incorrect" : ""}"><header><strong>Задание ${question.number}</strong><span>${question.isCorrect === true ? "Верно" : question.isCorrect === false ? "Неверно" : "Не проверяется автоматически"}</span></header><p>${escapeHtml(question.prompt)}</p>${question.options.length ? `<ul>${question.options.map((option) => `<li>${escapeHtml(option.text)}</li>`).join("")}</ul>` : ""}<dl><div><dt>Ответ ученика</dt><dd>${question.studentAnswers.length ? question.studentAnswers.map(escapeHtml).join(", ") : "Нет ответа"}</dd></div><div><dt>Верный ответ</dt><dd>${question.correctAnswers.length ? question.correctAnswers.map(escapeHtml).join(", ") : "Не задан для автопроверки"}</dd></div></dl>${question.explanation ? `<p class="attempt-explanation">${escapeHtml(question.explanation)}</p>` : ""}</article>`).join("")}</div>` : `<p class="detail-empty attempt-unavailable">${escapeHtml(payload.message || "Подробные ответы недоступны.")}</p>`}${attemptConversationMarkup(conversationPayload.conversation, attemptId)}</section>`;
      if (conversationPayload.conversation.unreadCount) await readConversation("test_attempt", attemptId);
      try {
        await api(`/inbox/test-attempts/${encodeURIComponent(attemptId)}/seen`, {
          method: "POST", body: JSON.stringify({}),
        });
        await reloadInbox();
      } catch {
        // The detailed attempt is still useful if acknowledging the queue item fails.
      }
    } catch (error) {
      pane.innerHTML = `<button class="action-button" type="button" data-back-to-attempts>← Ко всем попыткам</button><div class="table-state">${escapeHtml(error.message)}</div>`;
    }
  }

  async function openStudent(id) {
    studentBrowse.hidden = true;
    studentDetail.hidden = false;
    studentDetail.innerHTML = `<div class="table-state">Загружаем карточку ученика…</div>`;
    try { renderStudentDetail(await api(`/students/${id}/details`)); }
    catch (error) { studentDetail.innerHTML = `<div class="table-state">${escapeHtml(error.message)}</div>`; }
  }

  function eventTitle(event) {
    if (event.eventType === "lesson") return `${event.topic?.title || topicName(event.topicId)} · часть ${event.lessonPart}`;
    if (event.eventType === "test_deadline") return `Тест · ${event.topic?.title || topicName(event.topicId)}`;
    if (event.eventType === "homework_deadline") return `Вторая часть · ${event.topic?.title || topicName(event.topicId)}`;
    return event.mock?.title || "Тематический пробник";
  }

  function scheduleActions(event) {
    const cancelled = event.status === "cancelled";
    if (event.status === "completed") return `<span class="status status-accepted">Выполнено</span>`;
    const action = cancelled && event.eventType === "lesson" ? "replace" : event.eventType === "lesson" ? "move" : "set_deadline";
    const label = cancelled && event.eventType === "lesson" ? "Создать замену" : event.eventType === "lesson" ? "Перенести" : "Изменить дату";
    return `<input type="date" min="${todayMoscow()}" value="${escapeHtml(event.scheduledDate)}" aria-label="Новая дата"><button class="action-button" type="button" data-schedule-action="${action}">${label}</button>${event.eventType === "lesson" ? `<button class="action-button ${cancelled ? "" : "danger"}" type="button" data-schedule-action="${cancelled ? "restore" : "cancel"}">${cancelled ? "Восстановить" : "Отменить"}</button>` : ""}`;
  }

  function renderSchedule() {
    const student = document.querySelector("[data-schedule-filter='student']").value;
    const type = document.querySelector("[data-schedule-filter='type']").value;
    const period = document.querySelector("[data-schedule-filter='period']").value;
    const today = todayMoscow();
    const filtered = scheduleEvents.filter((event) => (!student || event.student.id === student)
      && (!type || event.eventType === type) && (period === "all" || event.scheduledDate >= today));
    scheduleState.hidden = Boolean(filtered.length);
    scheduleState.textContent = scheduleEvents.length ? "По выбранным фильтрам событий нет" : "Расписание пока не настроено";
    scheduleList.innerHTML = filtered.map((event) => `<article class="schedule-row ${event.status === "cancelled" ? "is-cancelled" : ""}" data-schedule-event="${event.id}" data-student-id="${event.student.id}">
      <div class="schedule-date"><strong>${dateOnly(event.scheduledDate)}</strong><span>${eventTypeNames[event.eventType]}</span></div>
      <div class="schedule-copy"><strong>${escapeHtml(event.student.name)}</strong><span>${escapeHtml(event.student.login)}</span><button class="action-button" type="button" data-open-schedule-student="${event.student.id}">Открыть карточку</button></div>
      <div class="schedule-copy"><strong>${escapeHtml(eventTitle(event))}</strong><span>${event.status === "cancelled" ? "Отменено" : event.originalScheduledDate ? `Перенесено с ${dateOnly(event.originalScheduledDate)}` : "Запланировано"}</span></div>
      <div class="schedule-actions">${scheduleActions(event)}</div>
    </article>`).join("");
  }

  function renderAdminTests() {
    const query = document.querySelector("[data-test-search]").value.trim().toLocaleLowerCase("ru");
    const filtered = adminTests.filter((test) => !query
      || String(test.lesson).includes(query)
      || test.title.toLocaleLowerCase("ru").includes(query));
    const state = document.querySelector("[data-tests-state]");
    state.hidden = Boolean(filtered.length);
    state.textContent = adminTests.length ? "По запросу тестов нет" : "Тесты не найдены";
    testList.innerHTML = filtered.map((test) => `<article class="test-admin-row">
      <span class="test-admin-number">Тема ${String(test.lesson).padStart(2, "0")}</span>
      <div><h2>${escapeHtml(test.title)}</h2><p>${escapeHtml(test.id)} · ${test.questionCount} вопросов · версия ${test.version}</p></div>
      <button class="action-button" type="button" data-edit-test="${escapeHtml(test.id)}">Редактировать</button>
    </article>`).join("");
  }

  function questionEditor(question) {
    const typeNames = { checkbox: "Несколько ответов", radio: "Один ответ", select: "Один ответ", text: "Текстовый ответ" };
    if (!question.editable) {
      return `<article class="test-question-editor is-readonly" data-editor-question="${escapeHtml(question.id)}"><header><strong>Задание ${question.number}</strong><span>${escapeHtml(typeNames[question.type] || question.type)}</span></header><p>${escapeHtml(question.prompt)}</p><p class="test-editor-error">Этот тип пока доступен только для чтения.</p></article>`;
    }
    const answerEditor = question.type === "text"
      ? `<label class="test-answer-key-field">Верные ответы <small>— один вариант на строку</small><textarea data-accepted-answers rows="3">${escapeHtml((question.acceptedAnswers || []).join("\n"))}</textarea></label>`
      : `<fieldset class="test-option-editor"><legend>Варианты и верный ответ</legend>${question.options.map((option) => `<label class="test-option-line"><input type="${question.type === "checkbox" ? "checkbox" : "radio"}" name="correct-${escapeHtml(question.id)}" value="${escapeHtml(option.id)}" ${option.correct ? "checked" : ""} aria-label="Верный ответ"><input type="text" value="${escapeHtml(option.text)}" data-option-id="${escapeHtml(option.id)}" maxlength="2000" required></label>`).join("")}</fieldset>`;
    return `<article class="test-question-editor" data-editor-question="${escapeHtml(question.id)}" data-question-type="${escapeHtml(question.type)}"><header><strong>Задание ${question.number}</strong><span>${escapeHtml(typeNames[question.type] || question.type)} · ${question.points} б.</span></header><label>Текст вопроса<textarea data-question-prompt rows="3" maxlength="10000" required>${escapeHtml(question.prompt)}</textarea></label>${answerEditor}<p class="test-editor-error" data-question-error></p></article>`;
  }

  function renderAdminTestEditor(test) {
    activeAdminTest = test;
    testBrowser.hidden = true;
    testEditor.hidden = false;
    document.querySelector("[data-test-editor-id]").textContent = `${test.id} · версия ${test.version}`;
    document.querySelector("[data-test-editor-title]").textContent = `Тема ${String(test.lesson).padStart(2, "0")} · ${test.title}`;
    document.querySelector("[data-test-editor-meta]").textContent = `${test.questionCount} вопросов. Изменения применяются только к новым попыткам.`;
    document.querySelector("[data-test-editor-message]").textContent = "";
    document.querySelector("[data-test-editor-questions]").innerHTML = test.questions.map(questionEditor).join("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function openAdminTest(testId) {
    document.querySelector("[data-tests-message]").textContent = "Загружаем тест…";
    try {
      const payload = await api(`/tests/${encodeURIComponent(testId)}`);
      document.querySelector("[data-tests-message]").textContent = "";
      renderAdminTestEditor(payload.test);
    } catch (error) {
      document.querySelector("[data-tests-message]").textContent = error.message;
    }
  }

  function editorPayload() {
    let valid = true;
    const questions = [...document.querySelectorAll("[data-editor-question]")].map((card) => {
      const source = activeAdminTest.questions.find((question) => question.id === card.dataset.editorQuestion);
      if (!source?.editable) return { id: source.id, type: source.type, prompt: source.prompt };
      const error = card.querySelector("[data-question-error]");
      const prompt = card.querySelector("[data-question-prompt]").value.trim();
      let message = prompt ? "" : "Введите текст вопроса.";
      const result = { id: source.id, type: source.type, prompt };
      if (source.type === "text") {
        result.acceptedAnswers = card.querySelector("[data-accepted-answers]").value.split("\n").map((value) => value.trim()).filter(Boolean);
        if (!result.acceptedAnswers.length) message ||= "Укажите хотя бы один верный ответ.";
        if (new Set(result.acceptedAnswers.map((value) => value.toLocaleLowerCase("ru"))).size !== result.acceptedAnswers.length) message ||= "Уберите повторяющиеся верные ответы.";
      } else {
        result.options = [...card.querySelectorAll("[data-option-id]")].map((input) => ({
          id: input.dataset.optionId,
          text: input.value.trim(),
          correct: card.querySelector(`[name="correct-${source.id}"][value="${input.dataset.optionId}"]`).checked,
        }));
        const correctCount = result.options.filter((option) => option.correct).length;
        if (result.options.some((option) => !option.text)) message ||= "Заполните все варианты.";
        if (new Set(result.options.map((option) => option.text.toLocaleLowerCase("ru"))).size !== result.options.length) message ||= "Варианты не должны повторяться.";
        if (source.type === "checkbox" && correctCount < 1) message ||= "Отметьте верные ответы.";
        if (["radio", "select"].includes(source.type) && correctCount !== 1) message ||= "Отметьте ровно один верный ответ.";
      }
      error.textContent = message;
      card.classList.toggle("has-error", Boolean(message));
      if (message) valid = false;
      return result;
    });
    return valid ? { questions } : null;
  }

  function showAccessError(error) {
    document.querySelectorAll("[data-panel], .admin-tabs").forEach((element) => element.classList.add("is-hidden"));
    document.querySelector("[data-access-state]").classList.remove("is-hidden");
    document.querySelector("[data-access-message]").textContent = error.status === 403
      ? "Эта страница доступна только преподавателю."
      : "Войдите в аккаунт преподавателя и откройте ссылку снова.";
  }

  function fillMaterialOptions() {
    if (courseSections.length) {
      sectionNames = Object.fromEntries(courseSections.map((section) => [section.id, section.label]));
    }
    const sections = Object.entries(sectionNames).map(([id, label]) => `<option value="${id}">${escapeHtml(label)}</option>`).join("");
    document.querySelector("[data-material-filter='section']").innerHTML = `<option value="">Все разделы</option>${sections}`;
    materialForm.elements.sectionId.innerHTML = `<option value="">Выберите раздел</option>${sections}`;
    const topics = courseTopics.map((topic) => `<option value="${escapeHtml(topic.id)}" data-section="${escapeHtml(topic.sectionId)}">Тема №${String(topic.lesson).padStart(2, "0")} — ${escapeHtml(topic.title)}</option>`).join("");
    document.querySelector("[data-material-filter='topic']").innerHTML = `<option value="">Все темы</option>${topics}`;
    materialForm.elements.topicId.innerHTML = `<option value="">Выберите тему</option>${topics}`;
  }

  function syncMaterialScopeFields(clearHiddenValues = false) {
    const scope = materialForm.elements.scope.value;
    const section = materialForm.elements.sectionId.value;
    const sectionField = document.querySelector("[data-material-section-field]");
    const topicField = document.querySelector("[data-material-topic-field]");
    const needsSection = scope === "section" || scope === "topic";
    const needsTopic = scope === "topic";
    sectionField.hidden = !needsSection;
    topicField.hidden = !needsTopic;
    materialForm.elements.sectionId.disabled = !needsSection;
    materialForm.elements.sectionId.required = needsSection;
    materialForm.elements.topicId.disabled = !needsTopic;
    materialForm.elements.topicId.required = needsTopic;
    if (clearHiddenValues && !needsSection) materialForm.elements.sectionId.value = "";
    if (clearHiddenValues && !needsTopic) materialForm.elements.topicId.value = "";
    [...materialForm.elements.topicId.options].forEach((option) => {
      option.hidden = Boolean(option.value && option.dataset.section !== section);
    });
    const selected = materialForm.elements.topicId.selectedOptions[0];
    if (selected?.hidden) materialForm.elements.topicId.value = "";
  }

  function renderMaterials() {
    const filters = Object.fromEntries([...document.querySelectorAll("[data-material-filter]")].map((element) => [element.dataset.materialFilter, element.value.trim()]));
    const query = filters.search.toLocaleLowerCase("ru");
    const filtered = materials.filter((item) => (!filters.scope || item.scope === filters.scope)
      && (!filters.section || item.sectionId === filters.section)
      && (!filters.topic || item.topicId === filters.topic) && (!filters.type || item.type === filters.type)
      && (!filters.status || item.status === filters.status)
      && (!query || item.title.toLocaleLowerCase("ru").includes(query)
        || item.subtitle?.toLocaleLowerCase("ru").includes(query)
        || item.fileName.toLocaleLowerCase("ru").includes(query)));
    materialState.hidden = Boolean(filtered.length);
    materialState.textContent = materials.length ? "По выбранным фильтрам материалов нет" : "Материалы пока не добавлены";
    materialList.innerHTML = filtered.map((item) => {
      const location = item.scope === "course" ? materialScopeNames.course
        : item.scope === "section" ? `${materialScopeNames.section} · ${item.sectionLabel}`
          : `${materialScopeNames.topic} · ${topicName(item.topicId)}`;
      return `<article class="material-row" data-material-id="${item.id}"><div><strong>${escapeHtml(item.title)}</strong>${item.subtitle ? `<span class="secondary-copy">${escapeHtml(item.subtitle)}</span>` : ""}<span class="secondary-copy">${escapeHtml(item.typeLabel)} · ${escapeHtml(location)}</span><span class="secondary-copy">${escapeHtml(feedbackRenderer.displayFilename(item.fileName))}${item.sizeBytes ? ` · ${formatBytes(item.sizeBytes)}` : ""} · ${dateTime(item.updatedAt || item.createdAt)}</span></div><span class="status status-${item.status}">${materialStatusNames[item.status]}</span><div class="material-actions"><a class="action-button" href="${escapeHtml(item.downloadUrl)}">Скачать</a><button class="action-button" type="button" data-edit-material="${item.id}">Редактировать</button>${item.status !== "published" ? `<button class="action-button" type="button" data-material-status="published">Опубликовать</button>` : `<button class="action-button" type="button" data-material-status="hidden">Скрыть</button>`}${item.status !== "archived" ? `<button class="action-button danger" type="button" data-material-status="archived">В архив</button>` : ""}</div></article>`;
    }).join("");
  }

  function materialPayload(form = materialForm) {
    return {
      title: form.elements.title.value.trim(),
      type: form.elements.type.value,
      scope: form.elements.scope.value,
      sectionId: form.elements.scope.value === "course" ? null : form.elements.sectionId.value || null,
      topicId: form.elements.scope.value === "topic" ? form.elements.topicId.value || null : null,
      subtitle: form.elements.subtitle.value.trim() || null,
      referenceKey: form.elements.referenceKey.value.trim() || null,
      contentVersion: form.elements.contentVersion.value.trim() || null,
      status: form.elements.status.value,
      sortOrder: Number(form.elements.sortOrder.value || 0),
    };
  }

  async function uploadMaterial(path, file, metadata = null, method = "POST") {
    const extension = file.name.toLocaleLowerCase("en").match(/\.[^.]+$/)?.[0] || "";
    const mimeByExtension = { ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };
    const headers = { "content-type": file.type || mimeByExtension[extension] || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) };
    if (metadata) headers["x-material-metadata"] = encodeURIComponent(JSON.stringify(metadata));
    const response = await fetch(`/api/admin${path}`, { method, credentials: "same-origin", headers, body: file });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || "Не удалось загрузить файл");
    return payload;
  }

  function openMaterialDialog(material = null) {
    materialForm.reset();
    materialForm.elements.materialId.value = material?.id || "";
    materialForm.elements.title.value = material?.title || "";
    materialForm.elements.type.value = material?.type || "additional";
    materialForm.elements.scope.value = material?.scope || "course";
    materialForm.elements.sectionId.value = material?.sectionId || "";
    materialForm.elements.topicId.value = material?.topicId || "";
    materialForm.elements.subtitle.value = material?.subtitle || "";
    materialForm.elements.status.value = material?.status || "published";
    materialForm.elements.sortOrder.value = material?.sortOrder || 0;
    materialForm.elements.referenceKey.value = material?.referenceKey || "";
    materialForm.elements.contentVersion.value = material?.contentVersion || "";
    syncMaterialScopeFields();
    materialForm.elements.file.required = !material;
    document.querySelector("[data-material-dialog-title]").textContent = material ? "Изменить материал" : "Новый материал";
    document.querySelector("[data-material-file-help]").textContent = material ? `— оставить пустым или заменить файл «${feedbackRenderer.displayFilename(material.fileName)}»` : "— PDF, DOCX, JPG или PNG; до 25 МБ";
    document.querySelector("[data-material-form-message]").textContent = "";
    materialDialog.showModal();
    materialForm.elements.title.focus();
  }

  async function loadWorkspace() {
    try {
      const access = await api("/access");
      document.querySelector("[data-admin-name]").textContent = access.user.name;
      const [studentPayload, inboxPayload, catalogPayload, schedulePayload, testsPayload, materialsPayload] = await Promise.all([
        api("/students"), api("/inbox"), api("/course-catalog"), api("/schedule"), api("/tests"), api("/materials"),
      ]);
      students = studentPayload.students;
      inboxItems = inboxPayload.items || [];
      submissions = inboxPayload.submissions;
      inboxCounts = inboxPayload.counts;
      courseTopics = catalogPayload.topics || [];
      courseSections = catalogPayload.sections || [];
      scheduleEvents = schedulePayload.events || [];
      adminTests = testsPayload.tests || [];
      materials = materialsPayload.materials || [];
      fillMaterialOptions(); updateFilterOptions(); renderInbox(); renderStudents(); renderSettings(); renderSchedule(); renderAdminTests(); renderMaterials();
    } catch (error) { showAccessError(error); }
  }

  function openStudentDialog(student = null) {
    const legacyName = student && !student.firstName && !student.lastName ? String(student.name || "").trim() : "";
    const note = document.querySelector("[data-legacy-name]");
    studentForm.reset();
    studentForm.elements.studentId.value = student?.id || "";
    studentForm.elements.firstName.value = student?.firstName || "";
    studentForm.elements.lastName.value = student?.lastName || "";
    studentForm.elements.middleName.value = student?.middleName || "";
    studentForm.elements.login.value = student?.login || "";
    note.hidden = !legacyName;
    note.textContent = legacyName ? `Ранее сохранено: ${legacyName}. Укажите имя и фамилию в отдельных полях.` : "";
    document.querySelector("[data-dialog-title]").textContent = student ? "Изменить ученика" : "Новый ученик";
    document.querySelector("[data-dialog-submit]").textContent = student ? "Сохранить" : "Создать";
    document.querySelector("[data-dialog-message]").textContent = "";
    studentDialog.showModal();
    studentForm.elements.firstName.focus();
  }

  function showLink(url, title, expiresAt) {
    generatedLink.value = url;
    document.querySelector("[data-link-title]").textContent = title;
    document.querySelector("[data-link-expiry]").textContent = expiresAt ? `Действует до ${dateTime(expiresAt)}.` : "";
    document.querySelector("[data-copy-message]").textContent = "";
    linkDialog.showModal();
  }

  async function performAccountAction(button) {
    const student = students.find((item) => item.id === button.dataset.id);
    if (!student) return;
    const action = button.dataset.accountAction;
    if (action === "edit") { openStudentDialog(student); return; }
    if (action === "archive" && !window.confirm(`Перенести ${student.name} в архив?`)) return;
    button.disabled = true;
    adminMessage.textContent = "";
    try {
      const routes = { activation: "activation-link", reset: "password-reset-link", block: "block", unblock: "unblock", archive: "archive" };
      const payload = await api(`/students/${student.id}/${routes[action]}`, { method: "POST" });
      if (payload.student) students = students.map((item) => item.id === student.id ? { ...item, ...payload.student } : item);
      if (payload.url) {
        if (action === "activation") students = students.map((item) => item.id === student.id ? { ...item, activationExpiresAt: payload.expiresAt, activationLinkStatus: "valid" } : item);
        showLink(payload.url, action === "reset" ? "Ссылка для смены пароля" : "Ссылка для активации", payload.expiresAt);
      }
      renderStudents(); renderSettings(); updateFilterOptions();
      if (activeStudentDetails?.student.id === student.id && payload.student) await openStudent(student.id);
    } catch (error) { adminMessage.textContent = error.message; button.disabled = false; }
  }

  function planFormValue() {
    return {
      startTopicId: studyPlanForm.elements.startTopicId.value,
      lessonWeekdays: [...studyPlanForm.querySelectorAll("input[name='lessonWeekday']:checked")].map((input) => Number(input.value)),
      effectiveFrom: studyPlanForm.elements.effectiveFrom.value || null,
      targetEndDate: studyPlanForm.elements.targetEndDate.value || null,
    };
  }

  function renderPlanPreview(preview) {
    const panel = document.querySelector("[data-study-plan-preview-panel]");
    const summary = preview.summary;
    const weekdays = (preview.settings.lessonWeekdays || []).map((weekday) => ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][weekday]).join(" / ");
    panel.hidden = false;
    panel.innerHTML = `<h3>Предварительный расчёт</h3><dl><div><dt>Учебные дни</dt><dd>${escapeHtml(weekdays)}</dd></div><div><dt>Первое занятие</dt><dd>${escapeHtml(summary.firstLessonDate)}</dd></div><div><dt>Ожидаемое завершение</dt><dd>${escapeHtml(summary.expectedEndDate)}</dd></div><div><dt>Тем в программе</dt><dd>${summary.topicCount}</dd></div><div><dt>Занятий</dt><dd>${summary.lessonCount}</dd></div><div><dt>Обязательных пробников</dt><dd>${summary.thematicMockCount}</dd></div></dl>${(summary.warnings || []).map((warning) => `<p class="study-plan-warning">${escapeHtml(warning.message)} Не хватает учебных слотов: ${warning.missingLessonSlots}.</p>`).join("")}`;
  }

  function renderStudyPlanEvents(payload) {
    activeStudyPlan = payload;
    const section = document.querySelector("[data-study-plan-current]");
    const container = document.querySelector("[data-study-plan-events]");
    section.hidden = !payload.plan;
    if (!payload.plan) { container.innerHTML = ""; return; }
    const today = todayMoscow();
    document.getElementById("study-plan-recalculate-date").min = today;
    const events = (payload.events || []).filter((event) => event.scheduledDate >= today || event.status === "cancelled");
    container.innerHTML = events.length ? events.map((event) => {
      const isLesson = event.eventType === "lesson";
      const cancelled = event.status === "cancelled";
      const action = cancelled && isLesson ? "replace" : isLesson ? "move" : "set_deadline";
      return `<article class="study-plan-event ${cancelled ? "is-cancelled" : ""}" data-plan-event="${event.id}"><div class="study-plan-event-date"><strong>${escapeHtml(event.scheduledDate)}</strong><span>${cancelled ? "Отменено" : event.originalScheduledDate ? "Перенесено" : "Запланировано"}</span></div><div class="study-plan-event-copy"><strong>${escapeHtml(eventTitle(event))}</strong><span>${escapeHtml(event.topic?.sectionLabel || event.mock?.sectionLabel || "")}</span></div><div class="study-plan-event-actions"><input type="date" min="${today}" value="${escapeHtml(event.scheduledDate)}" aria-label="Новая дата события"><button class="action-button" type="button" data-event-action="${action}">${cancelled && isLesson ? "Создать замену" : isLesson ? "Перенести" : "Изменить дату"}</button>${isLesson ? `<button class="action-button ${cancelled ? "" : "danger"}" type="button" data-event-action="${cancelled ? "restore" : "cancel"}">${cancelled ? "Восстановить" : "Отменить"}</button>` : ""}</div></article>`;
    }).join("") : `<div class="table-state">Будущих событий пока нет</div>`;
    document.getElementById("study-plan-recalculate-date").value ||= today;
  }

  function applyStudyPlanForm(plan) {
    studyPlanForm.elements.startTopicId.value = plan?.startTopicId || courseTopics[0]?.id || "";
    studyPlanForm.elements.effectiveFrom.value = plan?.effectiveFrom || "";
    studyPlanForm.elements.targetEndDate.value = plan?.targetEndDate || "";
    const selectedDays = new Set(plan?.lessonWeekdays || [2, 4]);
    studyPlanForm.querySelectorAll("input[name='lessonWeekday']").forEach((input) => {
      input.checked = selectedDays.has(Number(input.value));
    });
  }

  async function openStudyPlan(student) {
    activePlanStudent = student;
    previewSignature = null;
    document.querySelector("[data-study-plan-title]").textContent = student.name;
    document.querySelector("[data-study-plan-message]").textContent = "Загружаем расписание…";
    document.querySelector("[data-study-plan-preview-panel]").hidden = true;
    studyPlanForm.elements.startTopicId.innerHTML = courseTopics.map((topic) => `<option value="${escapeHtml(topic.id)}">Тема №${String(topic.lesson).padStart(2, "0")} — ${escapeHtml(topic.title)}</option>`).join("");
    studyPlanDialog.showModal();
    try {
      const payload = await api(`/students/${student.id}/study-plan`);
      const plan = payload.plan;
      applyStudyPlanForm(plan);
      document.querySelector("[data-study-plan-message]").textContent = plan ? "Настройки загружены. Изменения пересчитывают только будущее." : "Расписание пока не настроено.";
      renderStudyPlanEvents(payload);
    } catch (error) { document.querySelector("[data-study-plan-message]").textContent = error.message; }
  }

  function activatePanel(name) {
    document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("is-active", item.dataset.tab === name));
    document.querySelectorAll("[data-panel]").forEach((panel) => panel.classList.toggle("is-hidden", panel.dataset.panel !== name));
  }
  document.querySelectorAll("[data-tab]").forEach((tab) => tab.addEventListener("click", () => activatePanel(tab.dataset.tab)));
  document.querySelector("[data-inbox-filters]").addEventListener("click", (event) => {
    const button = event.target.closest("[data-inbox-kind]");
    if (!button) return;
    activeInboxKind = button.dataset.inboxKind;
    renderInbox();
  });
  document.querySelectorAll("[data-schedule-filter]").forEach((filter) => filter.addEventListener("change", renderSchedule));
  document.querySelectorAll("[data-material-filter]").forEach((filter) => filter.addEventListener(filter.type === "search" ? "input" : "change", renderMaterials));
  materialForm.elements.scope.addEventListener("change", () => syncMaterialScopeFields(true));
  materialForm.elements.sectionId.addEventListener("change", () => syncMaterialScopeFields(false));
  document.querySelector("[data-test-search]").addEventListener("input", renderAdminTests);
  testList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-test]");
    if (button) openAdminTest(button.dataset.editTest);
  });
  document.querySelector("[data-close-test-editor]").addEventListener("click", () => {
    activeAdminTest = null;
    testEditor.hidden = true;
    testBrowser.hidden = false;
  });
  testEditorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = editorPayload();
    const status = document.querySelector("[data-test-editor-message]");
    if (!payload) {
      status.textContent = "Исправьте отмеченные вопросы.";
      document.querySelector(".test-question-editor.has-error")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const button = document.querySelector("[data-save-test]");
    button.disabled = true;
    button.textContent = "Сохраняем…";
    status.textContent = "";
    try {
      await api(`/tests/${encodeURIComponent(activeAdminTest.id)}`, { method: "PUT", body: JSON.stringify(payload) });
      const refreshed = await api(`/tests/${encodeURIComponent(activeAdminTest.id)}`);
      adminTests = (await api("/tests")).tests || [];
      renderAdminTests();
      renderAdminTestEditor(refreshed.test);
      document.querySelector("[data-test-editor-message]").textContent = "Тест сохранён. Новая версия загружена с сервера.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = "Сохранить тест";
    }
  });
  inboxList.addEventListener("click", async (event) => {
    const attemptButton = event.target.closest("[data-open-inbox-attempt]");
    if (attemptButton) {
      const [studentId, attemptId] = attemptButton.dataset.openInboxAttempt.split(":");
      activatePanel("students");
      activeStudentTab = "tests";
      await openStudent(studentId);
      await openAttempt(attemptId);
      return;
    }
    const messageButton = event.target.closest("[data-open-inbox-conversation]");
    if (messageButton) {
      const [type, id, studentId] = messageButton.dataset.openInboxConversation.split(":");
      if (type === "test_attempt") {
        activatePanel("students");
        activeStudentTab = "tests";
        await openStudent(studentId);
        await openAttempt(id);
        document.querySelector(`[data-attempt-conversation="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        await openAdminConversation(type, id);
      }
      return;
    }
    const conversationButton = event.target.closest("[data-open-work-conversation]");
    if (conversationButton) {
      const [type, id] = conversationButton.dataset.openWorkConversation.split(":");
      await openAdminConversation(type, id);
      return;
    }
    const button = event.target.closest("[data-save-review]"); if (!button) return;
    const row = button.closest("[data-submission]");
    const [type, id] = row.dataset.submission.split(":");
    button.disabled = true; inboxMessage.textContent = "";
    try {
      await api(`/submissions/${type}/${id}/review`, { method: "PATCH", body: JSON.stringify({ status: row.querySelector("[data-review-status]").value, teacherComment: row.querySelector("[data-review-comment]").value }) });
      students = (await api("/students")).students;
      await reloadInbox();
      renderStudents(); renderSettings(); updateFilterOptions();
      inboxMessage.textContent = "Проверка сохранена.";
    } catch (error) { inboxMessage.textContent = error.message; button.disabled = false; }
  });
  studentList.addEventListener("click", (event) => { const button = event.target.closest("[data-open-student]"); if (button) openStudent(button.dataset.openStudent); });
  studentDetail.addEventListener("click", async (event) => {
    const removeAttachment = event.target.closest("[data-remove-conversation-file]");
    if (removeAttachment) {
      resetConversationAttachment(removeAttachment.closest("form"));
      return;
    }
    if (event.target.closest("[data-close-student]")) { studentDetail.hidden = true; studentBrowse.hidden = false; activeStudentDetails = null; return; }
    const tab = event.target.closest("[data-student-tab]"); if (tab) { renderStudentPane(tab.dataset.studentTab); return; }
    const attempt = event.target.closest("[data-open-attempt]"); if (attempt) { await openAttempt(attempt.dataset.openAttempt); return; }
    const workConversation = event.target.closest("[data-open-work-conversation]");
    if (workConversation) {
      const [type, id] = workConversation.dataset.openWorkConversation.split(":");
      await openAdminConversation(type, id);
      return;
    }
    if (event.target.closest("[data-back-to-attempts]")) { renderStudentPane("tests"); return; }
    const planButton = event.target.closest("[data-open-study-plan]"); if (planButton) { const student = students.find((item) => item.id === planButton.dataset.openStudyPlan); if (student) openStudyPlan(student); return; }
    const accountButton = event.target.closest("[data-account-action]"); if (accountButton) performAccountAction(accountButton);
  });
  studentDetail.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-inline-conversation-form]");
    if (!form) return;
    event.preventDefault();
    const [type, id] = form.dataset.inlineConversationForm.split(":");
    const status = form.querySelector("[data-inline-message]");
    const button = form.querySelector('button[type="submit"]');
    const body = form.elements.body.value.trim();
    const file = form.elements.attachment?.files[0] || null;
    if (!body && !file) { status.textContent = "Добавьте текст или файл."; return; }
    button.disabled = true; status.textContent = "Отправляем…";
    try {
      await sendConversationMessage(type, id, body, file);
      status.textContent = "Ответ отправлен.";
      await openAttempt(id);
      await reloadInbox();
    } catch (error) { status.textContent = error.message; button.disabled = false; }
  });
  studentDetail.addEventListener("change", (event) => {
    if (event.target.matches("[data-attempt-filter]")) renderAttemptList();
    if (event.target.matches('input[name="attachment"]')) {
      const form = event.target.closest("form");
      showConversationAttachment(form, form.querySelector("[data-inline-message]"));
    }
  });
  settingsList.addEventListener("click", (event) => { const button = event.target.closest("[data-account-action]"); if (button) performAccountAction(button); });
  scheduleList.addEventListener("click", async (event) => {
    const studentButton = event.target.closest("[data-open-schedule-student]");
    if (studentButton) { activatePanel("students"); await openStudent(studentButton.dataset.openScheduleStudent); return; }
    const button = event.target.closest("[data-schedule-action]"); if (!button) return;
    const row = button.closest("[data-schedule-event]");
    const body = { action: button.dataset.scheduleAction };
    if (["move", "set_deadline", "replace"].includes(body.action)) body.date = row.querySelector("input[type='date']").value;
    if (body.action === "cancel" && !window.confirm("Отменить это занятие? Оно останется в истории.")) return;
    button.disabled = true; scheduleMessage.textContent = "";
    try {
      await api(`/students/${row.dataset.studentId}/study-plan/events/${row.dataset.scheduleEvent}`, { method: "PATCH", body: JSON.stringify(body) });
      scheduleEvents = (await api("/schedule")).events; renderSchedule();
      scheduleMessage.textContent = "Расписание обновлено.";
    } catch (error) { scheduleMessage.textContent = error.message; button.disabled = false; }
  });

  document.querySelector("[data-create-student]").addEventListener("click", () => openStudentDialog());
  document.querySelector("[data-create-material]").addEventListener("click", () => openMaterialDialog());
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => studentDialog.close()));
  document.querySelectorAll("[data-close-material]").forEach((button) => button.addEventListener("click", () => materialDialog.close()));
  document.querySelectorAll("[data-close-link]").forEach((button) => button.addEventListener("click", () => linkDialog.close()));
  document.querySelector("[data-close-study-plan]").addEventListener("click", () => studyPlanDialog.close());
  document.querySelectorAll("[data-close-conversation]").forEach((button) => button.addEventListener("click", () => conversationDialog.close()));
  conversationDialog.addEventListener("close", () => { activeConversation = null; resetConversationAttachment(conversationForm); });
  conversationForm.elements.attachment.addEventListener("change", () => {
    showConversationAttachment(conversationForm, document.querySelector("[data-conversation-message]"));
  });
  conversationForm.querySelector("[data-remove-conversation-file]").addEventListener("click", () => resetConversationAttachment(conversationForm));
  conversationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!activeConversation) return;
    const body = conversationForm.elements.body.value.trim();
    const file = conversationForm.elements.attachment.files[0] || null;
    const status = document.querySelector("[data-conversation-message]");
    if (!body && !file) { status.textContent = "Добавьте текст или файл."; return; }
    const button = conversationForm.querySelector('button[type="submit"]');
    button.disabled = true; status.textContent = "Отправляем…";
    try {
      await sendConversationMessage(activeConversation.type, activeConversation.id, body, file);
      const payload = await api(`/conversations/${activeConversation.type}/${activeConversation.id}`);
      document.querySelector("[data-conversation-history]").innerHTML = conversationMarkup(payload.conversation);
      document.querySelector("[data-conversation-history]").scrollTop = document.querySelector("[data-conversation-history]").scrollHeight;
      conversationForm.reset(); resetConversationAttachment(conversationForm); status.textContent = "Ответ отправлен.";
      await reloadInbox();
    } catch (error) { status.textContent = error.message; } finally { button.disabled = false; }
  });

  studentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = document.querySelector("[data-dialog-submit]");
    const error = document.querySelector("[data-dialog-message]");
    const id = studentForm.elements.studentId.value;
    submit.disabled = true; error.textContent = "";
    try {
      const payload = await api(id ? `/students/${id}` : "/students", { method: id ? "PATCH" : "POST", body: JSON.stringify({ firstName: studentForm.elements.firstName.value, lastName: studentForm.elements.lastName.value, middleName: studentForm.elements.middleName.value, login: studentForm.elements.login.value }) });
      if (id) students = students.map((student) => student.id === id ? { ...student, ...payload.student } : student);
      else students.unshift(payload.student);
      renderStudents(); renderSettings(); updateFilterOptions(); studentDialog.close();
      if (payload.activationUrl) showLink(payload.activationUrl, "Ссылка для активации", payload.expiresAt);
      if (activeStudentDetails?.student.id === id) await openStudent(id);
    } catch (requestError) { error.textContent = requestError.message; }
    finally { submit.disabled = false; }
  });

  materialList.addEventListener("click", async (event) => {
    const row = event.target.closest("[data-material-id]");
    if (!row) return;
    const material = materials.find((item) => item.id === row.dataset.materialId);
    if (!material) return;
    const edit = event.target.closest("[data-edit-material]");
    if (edit) { openMaterialDialog(material); return; }
    const statusButton = event.target.closest("[data-material-status]");
    if (!statusButton) return;
    const status = statusButton.dataset.materialStatus;
    if (status === "archived" && !window.confirm(`Перенести «${material.title}» в архив?`)) return;
    statusButton.disabled = true;
    document.querySelector("[data-material-message]").textContent = "";
    try {
      const payload = await api(`/materials/${material.id}`, { method: "PATCH", body: JSON.stringify({ ...materialPayload({ elements: {
        title: { value: material.title }, type: { value: material.type }, scope: { value: material.scope },
        sectionId: { value: material.sectionId || "" }, topicId: { value: material.topicId || "" },
        subtitle: { value: material.subtitle || "" }, referenceKey: { value: material.referenceKey || "" },
        contentVersion: { value: material.contentVersion || "" }, status: { value: status }, sortOrder: { value: material.sortOrder },
      } }) }) });
      materials = materials.map((item) => item.id === material.id ? payload.material : item);
      renderMaterials();
      document.querySelector("[data-material-message]").textContent = status === "published" ? "Материал опубликован." : status === "hidden" ? "Материал скрыт." : "Материал перенесён в архив.";
    } catch (error) { document.querySelector("[data-material-message]").textContent = error.message; statusButton.disabled = false; }
  });

  materialForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = materialForm.elements.materialId.value;
    const file = materialForm.elements.file.files[0];
    const metadata = materialPayload();
    const submit = document.querySelector("[data-save-material]");
    const message = document.querySelector("[data-material-form-message]");
    if (!id && !file) { message.textContent = "Выберите файл."; return; }
    submit.disabled = true; message.textContent = "Сохраняем…";
    try {
      if (id) {
        await api(`/materials/${id}`, { method: "PATCH", body: JSON.stringify(metadata) });
        if (file) await uploadMaterial(`/materials/${id}/file`, file, null, "PUT");
      } else {
        await uploadMaterial("/materials/file", file, metadata, "POST");
      }
      materials = (await api("/materials")).materials || [];
      renderMaterials(); materialDialog.close();
      document.querySelector("[data-material-message]").textContent = id ? "Материал обновлён." : "Материал добавлен.";
    } catch (error) { message.textContent = error.message; }
    finally { submit.disabled = false; }
  });

  document.querySelector("[data-copy-link]").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(generatedLink.value); document.querySelector("[data-copy-message]").textContent = "Ссылка скопирована"; }
    catch { generatedLink.select(); document.querySelector("[data-copy-message]").textContent = "Выделили ссылку — скопируйте её"; }
  });

  studyPlanForm.addEventListener("input", () => {
    if (!previewSignature) return;
    previewSignature = null;
    document.querySelector("[data-study-plan-preview-panel]").hidden = true;
    document.querySelector("[data-study-plan-message]").textContent = "Настройки изменены — обновите предварительный расчёт.";
  });
  document.querySelector("[data-study-plan-preview]").addEventListener("click", async () => {
    const status = document.querySelector("[data-study-plan-message]");
    try {
      const values = planFormValue();
      const payload = await api(`/students/${activePlanStudent.id}/study-plan/preview`, { method: "POST", body: JSON.stringify(values) });
      previewSignature = JSON.stringify(values); renderPlanPreview(payload);
      status.textContent = "Расчёт готов. Проверьте даты перед сохранением.";
    } catch (error) { status.textContent = error.message; }
  });
  studyPlanForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("[data-study-plan-message]");
    if (activeStudyPlan?.plan && !window.confirm("Пересчитать только будущие события? Прошлое и выполненные работы останутся без изменений.")) return;
    const submit = studyPlanForm.querySelector("button[type='submit']"); submit.disabled = true;
    try {
      await api(`/students/${activePlanStudent.id}/study-plan`, { method: "PUT", body: JSON.stringify(planFormValue()) });
      const payload = await api(`/students/${activePlanStudent.id}/study-plan`);
      applyStudyPlanForm(payload.plan);
      renderStudyPlanEvents(payload); if (payload.summary) renderPlanPreview({ settings: payload.plan, summary: payload.summary });
      previewSignature = JSON.stringify(planFormValue()); status.textContent = "Учебный план сохранён.";
      scheduleEvents = (await api("/schedule")).events; renderSchedule();
      const refreshed = await api("/students"); students = refreshed.students; renderStudents(); renderSettings(); updateFilterOptions();
    } catch (error) { status.textContent = error.message; }
    finally { submit.disabled = false; }
  });
  document.querySelector("[data-study-plan-events]").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-event-action]"); if (!button) return;
    const row = button.closest("[data-plan-event]"); const body = { action: button.dataset.eventAction };
    if (["move", "set_deadline", "replace"].includes(body.action)) body.date = row.querySelector("input[type='date']").value;
    if (body.action === "cancel" && !window.confirm("Отменить это занятие? Оно останется в истории.")) return;
    button.disabled = true;
    try {
      const payload = await api(`/students/${activePlanStudent.id}/study-plan/events/${row.dataset.planEvent}`, { method: "PATCH", body: JSON.stringify(body) });
      renderStudyPlanEvents(payload); document.querySelector("[data-study-plan-message]").textContent = payload.warnings?.join(" ") || "Расписание обновлено.";
    } catch (error) { document.querySelector("[data-study-plan-message]").textContent = error.message; button.disabled = false; }
  });
  document.querySelector("[data-study-plan-recalculate]").addEventListener("click", async (event) => {
    const fromDate = document.getElementById("study-plan-recalculate-date").value;
    if (!fromDate || !window.confirm(`Пересчитать только будущие события начиная с ${fromDate}?`)) return;
    event.currentTarget.disabled = true;
    try {
      await api(`/students/${activePlanStudent.id}/study-plan/recalculate`, { method: "POST", body: JSON.stringify({ fromDate }) });
      const payload = await api(`/students/${activePlanStudent.id}/study-plan`);
      applyStudyPlanForm(payload.plan);
      renderStudyPlanEvents(payload); if (payload.summary) renderPlanPreview({ settings: payload.plan, summary: payload.summary });
      document.querySelector("[data-study-plan-message]").textContent = payload.warnings?.map((warning) => warning.message || warning).join(" ") || "Будущее расписание пересчитано.";
      scheduleEvents = (await api("/schedule")).events; renderSchedule();
    } catch (error) { document.querySelector("[data-study-plan-message]").textContent = error.message; }
    finally { event.currentTarget.disabled = false; }
  });

  loadWorkspace();
})();

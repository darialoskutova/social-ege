"use strict";

(() => {
  const list = document.querySelector("[data-student-list]");
  const tableState = document.querySelector("[data-table-state]");
  const message = document.querySelector("[data-admin-message]");
  const dialog = document.querySelector("[data-student-dialog]");
  const form = document.querySelector("[data-student-form]");
  const linkDialog = document.querySelector("[data-link-dialog]");
  const generatedLink = document.querySelector("[data-generated-link]");
  let students = [];
  let mockSubmissions = [];
  let courseTopics = [];
  let activePlanStudent = null;
  let activeStudyPlan = null;
  const studyPlanDialog = document.querySelector("[data-study-plan-dialog]");
  const studyPlanForm = document.querySelector("[data-study-plan-form]");

  const statusNames = {
    pending_activation: "Ожидает активации",
    active: "Активен",
    blocked: "Заблокирован",
    archived: "В архиве",
  };
  const submissionStatusNames = {
    submitted: "Отправлено",
    in_review: "На проверке",
    needs_revision: "Нужно исправить",
    accepted: "Проверено",
  };

  function escapeHtml(value) {
    const span = document.createElement("span");
    span.textContent = value == null ? "" : String(value);
    return span.innerHTML;
  }

  function date(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }

  function activationNote(student) {
    if (student.status !== "pending_activation") return "";
    if (student.activationLinkStatus === "valid" && student.activationExpiresAt) {
      return `<span class="activation-expiry">Ссылка действует до ${date(student.activationExpiresAt)}</span>`;
    }
    if (student.activationLinkStatus === "expired") {
      return `<span class="activation-expiry is-expired">Срок ссылки истёк</span>`;
    }
    return `<span class="activation-expiry">Нужна новая ссылка активации</span>`;
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

  function actions(student) {
    if (student.status === "archived") return "";
    const links = student.status === "pending_activation"
      ? `<button class="action-button" type="button" data-action="activation" data-id="${student.id}">Новая ссылка активации</button>`
      : student.status === "active"
        ? `<button class="action-button" type="button" data-action="reset" data-id="${student.id}">Ссылка для смены пароля</button>`
        : "";
    const access = student.status === "blocked"
      ? `<button class="action-button" type="button" data-action="unblock" data-id="${student.id}">Разблокировать</button>`
      : `<button class="action-button" type="button" data-action="block" data-id="${student.id}">Заблокировать</button>`;
    return `<button class="action-button" type="button" data-action="study-plan" data-id="${student.id}">Учебный план</button><button class="action-button" type="button" data-action="edit" data-id="${student.id}">Изменить</button>${links}${access}<button class="action-button danger" type="button" data-action="archive" data-id="${student.id}">В архив</button>`;
  }

  function render() {
    if (!students.length) {
      list.innerHTML = "";
      tableState.hidden = false;
      tableState.textContent = "Учеников пока нет";
      return;
    }
    tableState.hidden = true;
    list.innerHTML = students.map((student) => `
      <tr>
        <td><span class="student-name">${escapeHtml(student.name)}</span><span class="student-login">${escapeHtml(student.login)}</span>${activationNote(student)}</td>
        <td><span class="status status-${student.status}">${statusNames[student.status] || escapeHtml(student.status)}</span></td>
        <td>${date(student.createdAt)}</td><td>${date(student.lastLoginAt)}</td>
        <td><div class="actions">${actions(student)}</div></td>
      </tr>`).join("");
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
    return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} МБ`;
  }

  function renderMockSubmissions() {
    const body = document.querySelector("[data-mock-submission-list]");
    const state = document.querySelector("[data-mock-submission-state]");
    if (!mockSubmissions.length) {
      body.innerHTML = "";
      state.hidden = false;
      state.textContent = "Работ по пробникам пока нет";
      return;
    }
    state.hidden = true;
    body.innerHTML = mockSubmissions.map((submission) => `
      <tr>
        <td><span class="student-name">${escapeHtml(submission.studentName)}</span><span class="student-login">${escapeHtml(submission.studentLogin)}</span></td>
        <td><span class="student-name">${escapeHtml(submission.mock?.title || submission.mockId)}</span><span class="student-login">Версия ${escapeHtml(submission.mockVersion)}</span></td>
        <td><span class="submission-file-name">${escapeHtml(submission.fileName)}</span><span class="student-login">${formatBytes(submission.sizeBytes)} · редакция ${submission.fileRevision}</span></td>
        <td>${date(submission.updatedAt || submission.submittedAt)}<span class="status status-${escapeHtml(submission.status)}">${submissionStatusNames[submission.status] || escapeHtml(submission.status)}</span></td>
        <td><a class="action-button submission-download" href="${escapeHtml(submission.downloadUrl)}">Скачать</a></td>
      </tr>`).join("");
  }

  async function load() {
    try {
      const access = await api("/access");
      document.querySelector("[data-admin-name]").textContent = access.user.name;
      const [payload, mockPayload, catalogPayload] = await Promise.all([
        api("/students"),
        api("/mock-submissions"),
        api("/course-catalog"),
      ]);
      students = payload.students;
      mockSubmissions = mockPayload.submissions;
      courseTopics = catalogPayload.topics || [];
      render();
      renderMockSubmissions();
    } catch (error) {
      document.querySelectorAll("[data-panel], .admin-tabs").forEach((element) => element.classList.add("is-hidden"));
      const state = document.querySelector("[data-access-state]");
      state.classList.remove("is-hidden");
      document.querySelector("[data-access-message]").textContent = error.status === 403
        ? "Эта страница доступна только преподавателю."
        : "Войдите в аккаунт преподавателя и откройте ссылку снова.";
    }
  }

  function openStudentDialog(student = null) {
    const legacyName = student && !student.firstName && !student.lastName
      ? String(student.name || "").trim()
      : "";
    const legacyNameNote = document.querySelector("[data-legacy-name]");
    form.reset();
    form.elements.studentId.value = student?.id || "";
    form.elements.firstName.value = student?.firstName || "";
    form.elements.lastName.value = student?.lastName || "";
    form.elements.middleName.value = student?.middleName || "";
    form.elements.login.value = student?.login || "";
    legacyNameNote.hidden = !legacyName;
    legacyNameNote.textContent = legacyName
      ? `Ранее сохранено: ${legacyName}. Укажите имя и фамилию в отдельных полях.`
      : "";
    document.querySelector("[data-dialog-title]").textContent = student ? "Изменить ученика" : "Новый ученик";
    document.querySelector("[data-dialog-submit]").textContent = student ? "Сохранить" : "Создать";
    document.querySelector("[data-dialog-message]").textContent = "";
    dialog.showModal();
    form.elements.firstName.focus();
  }

  function showLink(url, title, expiresAt) {
    generatedLink.value = url;
    document.querySelector("[data-link-title]").textContent = title;
    document.querySelector("[data-link-expiry]").textContent = expiresAt
      ? `Действует до ${date(expiresAt)}.`
      : "";
    document.querySelector("[data-copy-message]").textContent = "";
    linkDialog.showModal();
  }

  function dateOnly(value) {
    return value ? String(value).slice(0, 10) : "";
  }

  function todayMoscow() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function planFormValue() {
    return {
      startTopicId: studyPlanForm.elements.startTopicId.value,
      lessonWeekdays: [...studyPlanForm.querySelectorAll("input[name='lessonWeekday']:checked")]
        .map((input) => Number(input.value)),
      effectiveFrom: studyPlanForm.elements.effectiveFrom.value || null,
      targetEndDate: studyPlanForm.elements.targetEndDate.value || null,
    };
  }

  function eventTitle(event) {
    if (event.eventType === "lesson") return `Тема ${event.topic?.lessonLabel || ""} · занятие ${event.lessonPart}`;
    if (event.eventType === "test_deadline") return `Тест · тема ${event.topic?.lessonLabel || ""}`;
    if (event.eventType === "homework_deadline") return `Вторая часть · тема ${event.topic?.lessonLabel || ""}`;
    return event.mock?.title || "Тематический пробник";
  }

  function eventDescription(event) {
    if (event.topic) return event.topic.title;
    return event.mock?.sectionLabel || "Пробник по завершённому разделу";
  }

  function renderPlanPreview(preview) {
    const panel = document.querySelector("[data-study-plan-preview-panel]");
    const summary = preview.summary;
    const weekdays = (preview.settings.lessonWeekdays || []).map((weekday) => ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][weekday]).join(" / ");
    const warnings = summary.warnings || [];
    panel.hidden = false;
    panel.innerHTML = `
      <h3>Предварительный расчёт</h3>
      <dl>
        <div><dt>Учебные дни</dt><dd>${escapeHtml(weekdays)}</dd></div>
        <div><dt>Первое занятие</dt><dd>${escapeHtml(summary.firstLessonDate)}</dd></div>
        <div><dt>Ожидаемое завершение</dt><dd>${escapeHtml(summary.expectedEndDate)}</dd></div>
        <div><dt>Тем</dt><dd>${summary.topicCount}</dd></div>
        <div><dt>Занятий</dt><dd>${summary.lessonCount}</dd></div>
        <div><dt>Обязательных пробников</dt><dd>${summary.thematicMockCount}</dd></div>
      </dl>
      ${warnings.map((warning) => `<p class="study-plan-warning">${escapeHtml(warning.message)} Не хватает учебных слотов: ${warning.missingLessonSlots}.</p>`).join("")}`;
  }

  function renderStudyPlanEvents(payload) {
    activeStudyPlan = payload;
    const section = document.querySelector("[data-study-plan-current]");
    const container = document.querySelector("[data-study-plan-events]");
    section.hidden = !payload.plan;
    if (!payload.plan) {
      container.innerHTML = "";
      return;
    }
    const today = todayMoscow();
    document.getElementById("study-plan-recalculate-date").min = today;
    const events = (payload.events || []).filter((event) => event.scheduledDate >= today || event.status === "cancelled");
    container.innerHTML = events.length ? events.map((event) => {
      const isLesson = event.eventType === "lesson";
      const cancelled = event.status === "cancelled";
      const eventAction = cancelled && isLesson ? "replace" : isLesson ? "move" : "set_deadline";
      const actionLabel = cancelled && isLesson ? "Создать замену" : isLesson ? "Перенести" : "Изменить дату";
      return `<article class="study-plan-event ${cancelled ? "is-cancelled" : ""}" data-plan-event="${event.id}">
        <div class="study-plan-event-date"><strong>${escapeHtml(event.scheduledDate)}</strong><span>${cancelled ? "Отменено" : event.originalScheduledDate ? "Перенесено" : "Запланировано"}</span></div>
        <div class="study-plan-event-copy"><strong>${escapeHtml(eventTitle(event))}</strong><span>${escapeHtml(eventDescription(event))}</span></div>
        <div class="study-plan-event-actions">
          <input type="date" min="${today}" value="${escapeHtml(event.scheduledDate)}" aria-label="Новая дата события">
          <button class="action-button" type="button" data-event-action="${eventAction}">${actionLabel}</button>
          ${isLesson ? `<button class="action-button ${cancelled ? "" : "danger"}" type="button" data-event-action="${cancelled ? "restore" : "cancel"}">${cancelled ? "Восстановить" : "Отменить"}</button>` : ""}
        </div>
      </article>`;
    }).join("") : `<div class="table-state">Будущих событий пока нет</div>`;
    document.getElementById("study-plan-recalculate-date").value ||= today;
  }

  async function openStudyPlan(student) {
    activePlanStudent = student;
    document.querySelector("[data-study-plan-title]").textContent = student.name;
    document.querySelector("[data-study-plan-message]").textContent = "Загружаем расписание…";
    document.querySelector("[data-study-plan-preview-panel]").hidden = true;
    studyPlanForm.elements.startTopicId.innerHTML = courseTopics.map((topic) => `
      <option value="${escapeHtml(topic.id)}">Тема №${String(topic.lesson).padStart(2, "0")} — ${escapeHtml(topic.title)}</option>`).join("");
    studyPlanDialog.showModal();
    try {
      const payload = await api(`/students/${student.id}/study-plan`);
      const plan = payload.plan;
      studyPlanForm.elements.startTopicId.value = plan?.startTopicId || courseTopics[0]?.id || "";
      studyPlanForm.elements.effectiveFrom.value = plan?.effectiveFrom || "";
      studyPlanForm.elements.targetEndDate.value = plan?.targetEndDate || "";
      const selectedDays = new Set(plan?.lessonWeekdays || [2, 4]);
      studyPlanForm.querySelectorAll("input[name='lessonWeekday']").forEach((input) => {
        input.checked = selectedDays.has(Number(input.value));
      });
      document.querySelector("[data-study-plan-message]").textContent = plan
        ? "Настройки загружены. Изменения пересчитывают только будущее."
        : "Расписание пока не настроено.";
      renderStudyPlanEvents(payload);
    } catch (error) {
      document.querySelector("[data-study-plan-message]").textContent = error.message;
    }
  }

  document.querySelector("[data-create-student]").addEventListener("click", () => openStudentDialog());
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  document.querySelectorAll("[data-close-link]").forEach((button) => button.addEventListener("click", () => linkDialog.close()));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = document.querySelector("[data-dialog-submit]");
    const error = document.querySelector("[data-dialog-message]");
    const id = form.elements.studentId.value;
    submit.disabled = true;
    error.textContent = "";
    try {
      const payload = await api(id ? `/students/${id}` : "/students", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify({
          firstName: form.elements.firstName.value,
          lastName: form.elements.lastName.value,
          middleName: form.elements.middleName.value,
          login: form.elements.login.value,
        }),
      });
      if (id) {
        students = students.map((student) => student.id === id ? { ...student, ...payload.student } : student);
      } else {
        students.unshift(payload.student);
      }
      render();
      dialog.close();
      if (payload.activationUrl) showLink(payload.activationUrl, "Ссылка для активации", payload.expiresAt);
    } catch (requestError) {
      error.textContent = requestError.message;
    } finally {
      submit.disabled = false;
    }
  });

  list.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const student = students.find((item) => item.id === button.dataset.id);
    if (!student) return;
    if (button.dataset.action === "study-plan") { openStudyPlan(student); return; }
    if (button.dataset.action === "edit") { openStudentDialog(student); return; }
    if (button.dataset.action === "archive" && !window.confirm(`Перенести ${student.name} в архив?`)) return;
    button.disabled = true;
    message.textContent = "";
    try {
      const routes = {
        activation: "activation-link", reset: "password-reset-link",
        block: "block", unblock: "unblock", archive: "archive",
      };
      const payload = await api(`/students/${student.id}/${routes[button.dataset.action]}`, { method: "POST" });
      if (payload.student) {
        students = students.map((item) => item.id === student.id ? { ...item, ...payload.student } : item);
        render();
      }
      if (payload.url) {
        if (button.dataset.action === "activation") {
          students = students.map((item) => item.id === student.id ? {
            ...item, activationExpiresAt: payload.expiresAt, activationLinkStatus: "valid",
          } : item);
          render();
        }
        showLink(payload.url, button.dataset.action === "reset" ? "Ссылка для смены пароля" : "Ссылка для активации", payload.expiresAt);
      }
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
    }
  });

  document.querySelector("[data-copy-link]").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(generatedLink.value);
      document.querySelector("[data-copy-message]").textContent = "Ссылка скопирована";
    } catch {
      generatedLink.select();
      document.querySelector("[data-copy-message]").textContent = "Выделили ссылку — скопируйте её";
    }
  });

  document.querySelector("[data-close-study-plan]").addEventListener("click", () => studyPlanDialog.close());

  document.querySelector("[data-study-plan-preview]").addEventListener("click", async () => {
    const status = document.querySelector("[data-study-plan-message]");
    try {
      const payload = await api(`/students/${activePlanStudent.id}/study-plan/preview`, {
        method: "POST", body: JSON.stringify(planFormValue()),
      });
      renderPlanPreview(payload);
      status.textContent = "Расчёт готов. Проверьте даты перед сохранением.";
    } catch (error) {
      status.textContent = error.message;
    }
  });

  studyPlanForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("[data-study-plan-message]");
    if (activeStudyPlan?.plan && !window.confirm("Пересчитать только будущие события? Прошлое и выполненные работы останутся без изменений.")) return;
    const submit = studyPlanForm.querySelector("button[type='submit']");
    submit.disabled = true;
    try {
      const payload = await api(`/students/${activePlanStudent.id}/study-plan`, {
        method: "PUT", body: JSON.stringify(planFormValue()),
      });
      renderStudyPlanEvents(payload);
      if (payload.summary) renderPlanPreview({ settings: payload.plan, summary: payload.summary });
      status.textContent = "Учебный план сохранён.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  document.querySelector("[data-study-plan-events]").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-event-action]");
    if (!button) return;
    const row = button.closest("[data-plan-event]");
    const action = button.dataset.eventAction;
    const body = { action };
    if (action === "move" || action === "set_deadline" || action === "replace") body.date = row.querySelector("input[type='date']").value;
    if (action === "cancel" && !window.confirm("Отменить это занятие? Оно останется в истории.")) return;
    button.disabled = true;
    try {
      const payload = await api(`/students/${activePlanStudent.id}/study-plan/events/${row.dataset.planEvent}`, {
        method: "PATCH", body: JSON.stringify(body),
      });
      renderStudyPlanEvents(payload);
      document.querySelector("[data-study-plan-message]").textContent = payload.warnings?.join(" ") || "Расписание обновлено.";
    } catch (error) {
      document.querySelector("[data-study-plan-message]").textContent = error.message;
      button.disabled = false;
    }
  });

  document.querySelector("[data-study-plan-recalculate]").addEventListener("click", async (event) => {
    const fromDate = document.getElementById("study-plan-recalculate-date").value;
    if (!fromDate || !window.confirm(`Пересчитать только будущие события начиная с ${fromDate}?`)) return;
    event.currentTarget.disabled = true;
    try {
      const payload = await api(`/students/${activePlanStudent.id}/study-plan/recalculate`, {
        method: "POST", body: JSON.stringify({ fromDate }),
      });
      renderStudyPlanEvents(payload);
      if (payload.summary) renderPlanPreview({ settings: payload.plan, summary: payload.summary });
      document.querySelector("[data-study-plan-message]").textContent = payload.warnings?.map((warning) => warning.message || warning).join(" ") || "Будущее расписание пересчитано.";
    } catch (error) {
      document.querySelector("[data-study-plan-message]").textContent = error.message;
    } finally {
      event.currentTarget.disabled = false;
    }
  });

  document.querySelectorAll("[data-tab]").forEach((tab) => tab.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("is-active", item === tab));
    const requestedPanel = document.querySelector(`[data-panel='${tab.dataset.tab}']`);
    const placeholder = document.querySelector("[data-panel='placeholder']");
    document.querySelectorAll("[data-panel]").forEach((panel) => {
      if (panel === placeholder) return;
      panel.classList.toggle("is-hidden", panel !== requestedPanel);
    });
    placeholder.classList.toggle("is-hidden", Boolean(requestedPanel));
    if (!requestedPanel) document.querySelector("[data-placeholder-title]").textContent = tab.textContent;
  }));

  load();
})();

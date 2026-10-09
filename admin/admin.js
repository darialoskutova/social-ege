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
    return `<button class="action-button" type="button" data-action="edit" data-id="${student.id}">Изменить</button>${links}${access}<button class="action-button danger" type="button" data-action="archive" data-id="${student.id}">В архив</button>`;
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
      const [payload, mockPayload] = await Promise.all([api("/students"), api("/mock-submissions")]);
      students = payload.students;
      mockSubmissions = mockPayload.submissions;
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

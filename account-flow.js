"use strict";

(() => {
  const root = document.querySelector("[data-account-flow]");
  if (!root) return;

  const flow = root.dataset.accountFlow;
  const endpoint = flow === "activation" ? "/api/account/activate" : "/api/account/reset-password";
  const title = flow === "activation" ? "Активация аккаунта" : "Новый пароль";
  const queryParams = new URLSearchParams(window.location.search);
  const fragmentParams = new URLSearchParams(window.location.hash.slice(1));
  const token = fragmentParams.get("token") || queryParams.get("token") || "";
  const form = root.querySelector("form");
  const message = root.querySelector("[data-message]");
  const account = root.querySelector("[data-account]");
  const submit = form.querySelector("button[type='submit']");

  document.title = `${title} — ЕГЭ по обществознанию`;
  root.querySelector("h1").textContent = title;
  window.history.replaceState({}, document.title, window.location.pathname);

  function showError(text) {
    message.classList.remove("success");
    message.textContent = text;
  }

  async function request(path, body) {
    const response = await fetch(endpoint + path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || "Не удалось продолжить");
    return payload;
  }

  async function initialise() {
    if (token.length < 32) {
      form.classList.add("is-hidden");
      showError("Ссылка недействительна или истекла");
      return;
    }
    try {
      const payload = await request("/validate", { token });
      account.textContent = flow === "activation"
        ? `Добро пожаловать, ${payload.account.name}. Ваш логин: ${payload.account.login}`
        : `${payload.account.name}, задайте новый пароль для логина ${payload.account.login}.`;
      form.classList.remove("is-hidden");
    } catch (error) {
      form.classList.add("is-hidden");
      showError(error.message);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const password = String(data.get("password") || "");
    const confirmation = String(data.get("confirmation") || "");
    if (password.length < 12) {
      showError("Пароль должен содержать не меньше 12 символов");
      return;
    }
    if (password !== confirmation) {
      showError("Пароли не совпадают");
      return;
    }
    submit.disabled = true;
    showError("");
    try {
      await request("", { token, password });
      form.reset();
      form.classList.add("is-hidden");
      message.classList.add("success");
      message.textContent = flow === "activation"
        ? "Аккаунт активирован. Теперь можно войти."
        : "Пароль изменён. Войдите с новым паролем.";
      root.querySelector("[data-login-link]").classList.remove("is-hidden");
    } catch (error) {
      showError(error.message);
      submit.disabled = false;
    }
  });

  initialise();
})();

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("login-error");
  err.textContent = "";
  const r = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: document.getElementById("pw").value }),
  });
  if (r.ok) { window.location = "/"; return; }
  const body = await r.json().catch(() => ({}));
  err.textContent = body.detail || "Sign-in failed";
});

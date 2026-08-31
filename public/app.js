// Release notes cost an upstream request each, so a row fetches them the first
// time it is opened rather than up front.
document.addEventListener(
  "toggle",
  (event) => {
    const row = event.target;
    if (!(row instanceof HTMLDetailsElement) || !row.open) return;

    const box = row.querySelector(".notes");
    if (!box || box.dataset.state !== "idle") return;
    box.dataset.state = "loading";

    const query = new URLSearchParams({
      pkg: row.dataset.pkg || "",
      from: row.dataset.from || "",
      to: row.dataset.to || "",
    });

    fetch(`/notes?${query}`)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.text();
      })
      .then((html) => {
        box.innerHTML = html;
        box.dataset.state = "done";
      })
      .catch(() => {
        box.innerHTML =
          '<p class="empty">Could not load release notes. Close and reopen to retry.</p>';
        box.dataset.state = "idle";
      });
  },
  // `toggle` does not bubble, so it has to be caught on the way down.
  true,
);

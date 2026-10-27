// Counts describe visits/intent, never proof of a purchase or social sharing.
export function trackRap(event: "visit" | "photos_selected" | "sign_in_opened" | "checkout_clicked") {
  try {
    let sessionId = sessionStorage.getItem("booth-session");
    if (!sessionId) { sessionId = crypto.randomUUID(); sessionStorage.setItem("booth-session", sessionId); }
    void fetch("/api/rap/events", { method: "POST", credentials: "same-origin", keepalive: true,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, event }) }).catch(() => {});
  } catch { /* Analytics must not block creating a video. */ }
}

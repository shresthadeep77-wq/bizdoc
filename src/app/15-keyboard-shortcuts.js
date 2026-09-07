// ==================== KEYBOARD SHORTCUTS ====================
// Escape closes the top modal, "/" jumps to the visible search box, and Enter
// submits a form's primary action when you're not in a textarea.
document.addEventListener("keydown", (e) => {
  const tag = (e.target.tagName || "").toLowerCase();
  const typing = tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable;

  if (e.key === "Escape") {
    if (modalStack.length) { e.preventDefault(); attemptClose(); }
    else if (typing && tag === "input") e.target.blur();
    return;
  }

  // "/" focuses the search field of whatever list is on screen.
  if (e.key === "/" && !typing) {
    const box = document.querySelector(".modal .picker-list ~ input, .modal input[placeholder*='earch'], .search input, input[placeholder*='earch']");
    if (box) { e.preventDefault(); box.focus(); box.select && box.select(); }
    return;
  }

  // Enter fires the primary button of the open modal (not from a textarea,
  // where Enter means newline, and not when a button already has focus).
  if (e.key === "Enter" && !e.shiftKey && tag !== "textarea" && tag !== "button") {
    const scope = modalStack.length ? modalStack[modalStack.length - 1] : null;
    if (!scope) return;
    // Don't hijack Enter inside the stepped builder — too easy to save early.
    if (scope.querySelector(".builder-shell")) return;
    const primary = scope.querySelector(".action-bar .btn-primary, .btn-primary.btn-full");
    if (primary && !primary.disabled) { e.preventDefault(); primary.click(); }
  }
});

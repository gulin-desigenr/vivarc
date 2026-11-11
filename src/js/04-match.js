// Vivarc: how the command bar ranks its actions for what is typed, kept apart from the DOM so it can be tested.
(() => {
  // Every typed word must start a word of the action's name or of its search words (or appear inside the name).
  // A word of the name counts more than a search word, so "setting" ranks "Vivarc Settings" above actions that
  // only list "settings" among their words, and "vivarc set" finds "Vivarc Settings" first. 0 means no match.
  const actionScore = (label, words, typed) => {
    const needle = typed.trim().toLowerCase();
    const terms = needle.split(/\s+/).filter(Boolean);
    if (!terms.length) return 0;
    const name = label.toLowerCase();
    const nameWords = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const extra = (words || "").toLowerCase().split(/\s+/).filter(Boolean);
    let score = 0;
    for (const term of terms) {
      if (nameWords.some((w) => w.startsWith(term))) score += 3;
      else if (extra.some((w) => w.startsWith(term)) || name.includes(term)) score += 1;
      else return 0;
    }
    if (name.startsWith(needle)) score += 2;
    return score;
  };
  window.__vm.match = { actionScore };
})();

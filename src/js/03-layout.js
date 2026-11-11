// Vivarc layout arithmetic, kept apart from the DOM so it can be tested.
(() => {
  // Favorites share their rows evenly, like Dia's: seven tiles where five fit make two rows of four and three, not
  // five and two. Returns the number of columns for `count` tiles in `width` pixels (0 when there is nothing to lay out).
  const favColumns = (count, width, min = 60, gap = 6) => {
    if (!count || !width) return 0;
    const fit = Math.max(1, Math.floor((width + gap) / (min + gap)));
    return Math.ceil(count / Math.ceil(count / fit));
  };
  window.__vm.layout = { favColumns };
})();

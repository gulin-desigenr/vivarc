  const ICON_MAX = 20000;
  // Vivaldi's favicon database (filled by browsing and by Sync) knows icons for sites that are not open. For a
  // site it does not know it returns a stock globe instead of an error, so that globe is fingerprinted once and
  // treated as "no icon". Found icons join the per-profile cache like the ones learned from open tabs.
  // Ported from upstream KASOGIT/vivarc 0.1.18 (7428eda).
  const FAVICON_DB = "chrome://favicon/size/32@2x/";
  const loadImage = (src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  const pixelsOf = (img) => {
    const canvas = new OffscreenCanvas(img.naturalWidth || 1, img.naturalHeight || 1);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return { canvas, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
  };
  const samePixels = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  let stockGlobe = null;
  const globePixels = () => (stockGlobe ||= loadImage(`${FAVICON_DB}https://vivarc-no-icon.invalid/`)
    .then((img) => (img ? pixelsOf(img).data : null)).catch(() => null));
  const fromHistory = new Map();
  let saveIconsTimer = null;
  const saveIconsSoon = () => {
    clearTimeout(saveIconsTimer);
    saveIconsTimer = setTimeout(() => store.set("icons", icons), 2000);
  };
  const historyIcon = (url) => {
    const origin = originOf(url);
    if (!/^https?:/.test(origin)) return Promise.resolve(null);
    if (!fromHistory.has(origin)) {
      fromHistory.set(origin, (async () => {
        const img = await loadImage(FAVICON_DB + url);
        if (!img) return null;
        const { canvas, data } = pixelsOf(img);
        const globe = await globePixels();
        if (!globe || samePixels(data, globe)) return null;
        const value = await dataUrl(await canvas.convertToBlob({ type: "image/png" }));
        if (value.length >= ICON_MAX) return null;
        if (!icons[origin]) {
          icons[origin] = value;
          saveIconsSoon();
        }
        return value;
      })().catch(() => null));
    }
    return fromHistory.get(origin);
  };
  const dataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  // Some favicons are multi-size .ico files (Gmail's is 26 KB): too big to keep as is, so they are
  // redrawn at 64px, enough for the 24px tiles on a Retina screen.
  const shrinkIcon = async (blob) => {
    const bitmap = await createImageBitmap(blob, { resizeWidth: 64, resizeHeight: 64, resizeQuality: "high" });
    const canvas = new OffscreenCanvas(64, 64);
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    return dataUrl(await canvas.convertToBlob({ type: "image/png" }));
  };
  const cacheIcons = async () => {
    for (const t of state.allTabs) {
      const src = t.favIconUrl;
      const origin = originOf(t.url);
      if (!src || !/^https?:/.test(origin) || icons[origin] === src || icons[origin]?.startsWith("data:")) continue;
      let value = src;
      try {
        const blob = await (await fetch(src)).blob();
        value = await dataUrl(blob);
        if (value.length >= ICON_MAX) value = await shrinkIcon(blob);
      } catch (_) {}
      if (value.length < ICON_MAX) icons[origin] = value;
    }
    store.set("icons", icons);
  };

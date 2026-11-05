// Colour helpers: parse, WCAG contrast, the readable text colour for a background, a favicon's main colour,
// and the solid colour of a space theme. Pure functions, shared by the sidebar and the theme editor.
(() => {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const hex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("")}`;

  // "#rgb", "#rrggbb" or "rgb(r, g, b)" / "rgb(r g b / a)" -> [r, g, b]; anything else -> null.
  const parse = (text) => {
    const s = String(text || "").trim();
    let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    }
    m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    return m ? [+m[1], +m[2], +m[3]] : null;
  };

  const hslToRgb = (h, s, l) => {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return [0, 8, 4].map((n) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  };

  const rgbToHsl = ([r, g, b]) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return [0, 0, l * 100];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, s * 100, l * 100];
  };

  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  const LIGHT = "#ffffff", DARK = "#1b1b1f";
  // The text colour for `bg`: white while it keeps 3:1 (WCAG's ratio for bold/large text; white on saturated
  // mid tones reads better than WCAG's numbers say, and is what Vivaldi picks), otherwise whichever contrasts more.
  const textFor = (bg) => {
    const rgb = Array.isArray(bg) ? bg : parse(bg);
    if (!rgb) return null;
    const white = contrast(rgb, parse(LIGHT));
    return white >= 3 || white >= contrast(rgb, parse(DARK)) ? LIGHT : DARK;
  };

  // The main colour of an icon from its RGBA pixels: the most present saturated hue, averaged. Monochrome icons
  // give their colour only when dark (GitHub's black mark), since a pale grey is no colour for a tab.
  const dominant = (pixels) => {
    const bins = new Map();
    let grey = [0, 0, 0, 0];
    for (let i = 0; i + 3 < pixels.length; i += 4) {
      const a = pixels[i + 3] / 255;
      if (a < 0.5) continue;
      const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
      const [h, s, l] = rgbToHsl(rgb);
      if (s > 25 && l > 15 && l < 90) {
        const key = Math.round(h / 30) % 12;
        const bin = bins.get(key) || [0, 0, 0, 0];
        const w = a * s / 100;
        bin[0] += rgb[0] * w; bin[1] += rgb[1] * w; bin[2] += rgb[2] * w; bin[3] += w;
        bins.set(key, bin);
      } else {
        grey[0] += rgb[0] * a; grey[1] += rgb[1] * a; grey[2] += rgb[2] * a; grey[3] += a;
      }
    }
    const best = [...bins.values()].sort((p, q) => q[3] - p[3])[0];
    const total = [...bins.values()].reduce((n, b) => n + b[3], 0) + grey[3];
    if (best && best[3] >= total * 0.08) return hex(best.slice(0, 3).map((v) => v / best[3]));
    if (!grey[3]) return null;
    const avg = grey.slice(0, 3).map((v) => v / grey[3]);
    return rgbToHsl(avg)[2] < 35 ? hex(avg) : null;
  };

  // A space theme's solid colour, for open and hovered folders: the tint itself is the sidebar's background, so
  // pale tints get a saturated mid tone of the same hue and dark tints a lighter one.
  const spaceSolid = ({ hue, sat, light }) => {
    const rgb = light >= 58
      ? hslToRgb(hue, clamp(sat + 20, 30, 80), 52)
      : hslToRgb(hue, clamp(sat + 15, 25, 80), Math.min(light + 24, 62));
    return { bg: hex(rgb), fg: textFor(rgb) };
  };

  // Ink for text on a space's tint, like Arc: a deep shade of the tint's own hue on light tints, white on dark
  // ones, whichever reads better. `muted` (labels, New Tab, sleeping tabs) is the ink pulled towards the tint as
  // far as it can go while keeping 4.5:1, instead of a fixed opacity that fails on mid tones.
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const inkFor = (bg) => {
    const rgb = Array.isArray(bg) ? bg : parse(bg);
    if (!rgb) return null;
    const [h, s] = rgbToHsl(rgb);
    const dark = [hslToRgb(h, Math.min(s, 45), 11), [13, 13, 16]].find((c) => contrast(rgb, c) >= 7) || [0, 0, 0];
    const light = [255, 255, 255];
    const ink = contrast(rgb, dark) >= contrast(rgb, light) ? dark : light;
    let lo = 0, hi = 0.7; // how far towards the tint `muted` goes
    if (contrast(rgb, ink) <= 4.5) hi = 0;
    for (let i = 0; i < 12 && hi > 0; i++) {
      const t = (lo + hi) / 2;
      contrast(rgb, mix(ink, rgb, t)) >= 4.5 ? (lo = t) : (hi = t);
    }
    return { fg: hex(ink), muted: hex(mix(ink, rgb, lo)), ratio: contrast(rgb, ink) };
  };

  window.__vm.colors = { inkFor, mix, parse, hex, hslToRgb, rgbToHsl, luminance, contrast, textFor, dominant, spaceSolid };
})();

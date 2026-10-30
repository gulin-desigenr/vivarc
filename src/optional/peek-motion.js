// Personal fork: refine VividPeek's existing motion without modifying its verified upstream files.
(() => {
  const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const ease = (t, opening) => opening ? 1 - (1 - t) ** 3 : t * t * (3 - 2 * t);
  const frames = (start, end, opening) => {
    const steps = 32;
    const pxKeys = ["left", "top", "width", "height", "borderRadius"];
    return Array.from({ length: steps + 1 }, (_, i) => {
      const offset = i / steps;
      const amount = ease(offset, opening);
      const frame = { offset };
      for (const key of pxKeys) {
        if (start[key] != null && end[key] != null) {
          frame[key] = `${parseFloat(start[key]) + (parseFloat(end[key]) - parseFloat(start[key])) * amount}px`;
        }
      }
      if (start.opacity != null && end.opacity != null) frame.opacity = start.opacity + (end.opacity - start.opacity) * amount;
      return frame;
    });
  };
  const install = () => {
    const peek = window.ArcPeekDebug;
    if (!peek || peek.__vivarcMotion) return !!peek;
    if (typeof peek.getPanelScaleMotionGeometry !== "function" || typeof peek.getPanelRectMotionGeometry !== "function") return false;
    const originalScale = peek.getPanelScaleMotionGeometry.bind(peek);
    const originalRect = peek.getPanelRectMotionGeometry.bind(peek);
    const originalDuration = peek.getGlanceDuration.bind(peek);
    peek.getGlanceDuration = (direction) => reducedMotion() ? 1 : (direction === "closing" ? 240 : 300);
    peek.getPanelScaleMotionGeometry = (...args) => {
      const geometry = originalScale(...args);
      if (!geometry) return geometry;
      const x = geometry.panelTranslateX, y = geometry.panelTranslateY, scale = geometry.uniformScale;
      const sourceRadius = parseFloat(geometry.sourceRadius), finalRadius = parseFloat(geometry.finalRadius);
      const build = (opening) => Array.from({ length: 33 }, (_, i) => {
        const offset = i / 32, amount = ease(offset, opening), progress = opening ? amount : 1 - amount;
        return {
          offset,
          transform: `translate(${x * (1 - progress)}px, ${y * (1 - progress)}px) scale(${scale + (1 - scale) * progress})`,
          borderRadius: `${sourceRadius + (finalRadius - sourceRadius) * progress}px`,
          opacity: opening ? 0.94 + 0.06 * progress : 1,
        };
      });
      geometry.openingKeyframes = build(true);
      geometry.closingKeyframes = build(false);
      return geometry;
    };
    peek.getPanelRectMotionGeometry = (...args) => {
      const geometry = originalRect(...args);
      if (!geometry) return geometry;
      geometry.openingKeyframes = frames(geometry.openingKeyframes[0], geometry.openingKeyframes.at(-1), true);
      geometry.closingKeyframes = frames(geometry.closingKeyframes[0], geometry.closingKeyframes.at(-1), false);
      return geometry;
    };
    peek.__vivarcMotion = { originalDuration };
    return true;
  };
  if (install()) return;
  let attempts = 0;
  const timer = setInterval(() => {
    if (install() || ++attempts >= 100) clearInterval(timer);
  }, 100);
})();

  // ---- profile switcher ----
  const openProfile = (path) => vivaldi.runtimePrivate.openNamedProfile(path, (ok) => {
    if (!ok) console.warn("[vivarc] could not open profile", path);
  });

  const profileChip = (chip, index) => {
    const node = el("div", `vm-space-chip${chip.active ? " active" : ""}`);
    node.title = chip.active ? chip.name : `${chip.name}${index < 9 ? ` (⌃⌘${index + 1})` : ""}`;
    const letter = () => {
      const span = el("span", "vm-space-letter", chip.letter);
      span.style.backgroundColor = `hsl(${chip.hue} 38% 40%)`;
      return span;
    };
    if (chip.avatar) {
      const img = el("img");
      img.addEventListener("error", () => img.replaceWith(letter()));
      img.src = chip.avatar;
      node.append(img);
    } else {
      node.append(letter());
    }
    if (chip.active) {
      node.addEventListener("contextmenu", (e) => showMenu(e, [
        ["Manage Profiles…", () => vivaldi.runtimePrivate.openProfileSelectionWindow()],
      ]));
    } else {
      node.addEventListener("click", () => openProfile(chip.path));
    }
    return node;
  };

  const promptProfileName = (bar, plus) => {
    const field = el("input", "vm-space-input");
    field.placeholder = "New profile";
    try { vivaldi.runtimePrivate.getProfileDefaults((name) => { if (!field.value) field.value = name || ""; field.select(); }); } catch (_) {}
    plus.replaceWith(field);
    field.focus();
    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      const name = field.value.trim();
      if (commit && name) {
        const images = await new Promise((resolve) => vivaldi.runtimePrivate.getUserProfileImages(resolve));
        const index = Math.floor(Math.random() * (images?.length || 1));
        vivaldi.runtimePrivate.createProfile(name, index, false, (ok) => { if (!ok) console.warn("[vivarc] could not create the profile"); });
      }
      renderProfileBar();
    };
    field.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    field.addEventListener("blur", () => finish(false));
  };

  let profileBarEl = null;
  const renderProfileBar = () => {
    const chips = window.__vm.spaces.profileChips(state.profiles);
    if (!chips.length) { profileBarEl?.remove(); return; }
    profileBarEl ||= el("div", "vm-spaces");
    const plus = el("div", "vm-space-chip vm-space-plus", "+");
    plus.title = "New profile";
    plus.addEventListener("click", () => promptProfileName(profileBarEl, plus));
    profileBarEl.replaceChildren(...chips.map(profileChip), plus);
  };

  const placeProfileBar = () => {
    if (!profileBarEl?.isConnected && profileBarEl) {
      const toolbar = document.querySelector("#tabs-tabbar-container .toolbar-tabbar-after");
      toolbar?.prepend(profileBarEl);
    }
  };

  const loadProfiles = () => {
    try {
      vivaldi.runtimePrivate.getUserProfiles((list) => {
        state.profiles = list || [];
        renderProfileBar();
        placeProfileBar();
        window.__vm.spaces.syncBottomBar(window.__vm.spaces.wantsAccountButton(state.profiles)).catch((e) => console.warn("[vivarc] bottom bar:", e));
      });
    } catch (e) {
      console.warn("[vivarc] profile list unavailable:", e);
    }
  };

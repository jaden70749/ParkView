window.initializeParkViewSearch = ({ state, els, escapeHtml, refreshIcons, hideSearchSuggestions,
  resetMapSearch, selectSearchSuggestion, selectLot, loadKakaoMapSdk, renderSearchSuggestions,
  showFavoriteLotsFromMenu, renderMapMarkers }) => {
  const PLACES_KEY = "parkview.savedPlaces.v1";
  const RECENT_KEY = "parkview.recentSearches.v1";
  let panel;
  let home;
  let title;
  let status;
  let editing = null;
  let requestId = 0;
  let activeCategory = null;
  let categoryOverlays = [];
  const categoryIcons = { PK6: "square-parking", FD6: "utensils", CE7: "coffee", CS2: "store", SW8: "train-front", OL7: "fuel" };

  function read(key) {
    try {
      const items = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(items) ? items.filter(item => item && typeof item.name === "string"
        && Number.isFinite(item.latitude) && Number.isFinite(item.longitude)) : [];
    } catch (_) { return []; }
  }

  function write(key, items) {
    try { localStorage.setItem(key, JSON.stringify(items)); return true; }
    catch (_) { message("장소를 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요."); return false; }
  }

  function placeData(place) {
    return { id: String(place.id || ""), name: place.name, address: place.address || "",
      latitude: place.latitude, longitude: place.longitude, category: place.category || "장소" };
  }

  function message(text = "") {
    status.textContent = text;
    status.hidden = !text;
  }

  function update() {
    const query = els.searchInput.value.trim();
    home.hidden = Boolean(query) || Boolean(editing);
    title.textContent = editing ? `${editing.label} 등록` : query ? "장소 검색" : "어디로 갈까요?";
  }

  function open() {
    if (!panel) return;
    panel.hidden = false;
    els.searchPanel.classList.add("is-exploring");
    els.topControls?.classList.add("is-exploring");
    render();
    update();
  }

  function close() {
    if (!panel) return;
    panel.hidden = true;
    editing = null;
    if (!activeCategory) requestId += 1;
    window.clearTimeout(state.searchSuggestionTimer);
    state.searchSuggestionToken += 1;
    els.searchPanel.classList.remove("is-exploring");
    els.topControls?.classList.remove("is-exploring");
    hideSearchSuggestions();
    message();
  }

  function iconButton(icon, label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "discovery-icon-button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = `<i data-lucide="${icon}" aria-hidden="true"></i>`;
    button.addEventListener("click", action);
    return button;
  }

  function row(container, icon, name, detail, action, controls = []) {
    const element = document.createElement("div");
    element.className = "discovery-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "discovery-place";
    button.innerHTML = `<span class="discovery-place-icon"><i data-lucide="${icon}" aria-hidden="true"></i></span><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(detail)}</small></span>`;
    button.addEventListener("click", action);
    element.append(button, ...controls);
    container.append(element);
  }

  function empty(container, text) {
    const p = document.createElement("p");
    p.className = "discovery-empty";
    p.textContent = text;
    container.append(p);
  }

  function startSaving(key, label) {
    clearCategory();
    editing = { key, label };
    requestId += 1;
    resetMapSearch();
    open();
    message(`${label}로 저장할 장소나 주소를 검색하세요.`);
    els.searchInput.focus();
  }

  function render() {
    const places = read(PLACES_KEY);
    const saved = document.querySelector("#discoveryPlaces");
    saved.replaceChildren();
    const definitions = [{ key: "home", label: "집", icon: "house" },
      { key: "work", label: "회사·학교", icon: "building-2" },
      ...places.filter(p => p.key !== "home" && p.key !== "work")
        .map(p => ({ key: p.key, label: p.name, icon: "flag" }))];
    definitions.forEach(def => {
      const place = places.find(p => p.key === def.key);
      const controls = place ? [
        iconButton("pencil", `${def.label} 변경`, () => startSaving(def.key, def.label)),
        iconButton("x", `${def.label} 삭제`, () => { if (write(PLACES_KEY, places.filter(p => p.key !== def.key))) render(); })
      ] : [];
      row(saved, def.icon, def.label, place ? place.address || place.name : "주소 등록",
        () => place ? selectSearchSuggestion(place) : startSaving(def.key, def.label), controls);
    });
    document.querySelector("#addSavedPlace").disabled = places.filter(p => p.key !== "home" && p.key !== "work").length >= 5;

    const favorites = document.querySelector("#discoveryFavorites");
    favorites.replaceChildren();
    const lots = state.lots.filter(lot => state.favoriteLotIds.has(String(lot.id)));
    if (!lots.length) empty(favorites, "저장한 주차장이 없습니다.");
    lots.slice(0, 4).forEach(lot => row(favorites, "star", lot.name, lot.address || "",
      () => { clearCategory(); close(); els.searchInput.blur(); selectLot(lot, true); }));
    document.querySelector("#discoveryAllFavorites").hidden = !lots.length;

    const recent = document.querySelector("#discoveryRecent");
    recent.replaceChildren();
    const history = read(RECENT_KEY);
    if (!history.length) empty(recent, "최근 검색한 장소가 없습니다.");
    history.forEach((place, index) => row(recent, "history", place.name, place.address,
      () => selectSearchSuggestion(place), [iconButton("x", `${place.name} 검색 기록 삭제`, () => {
        if (write(RECENT_KEY, history.filter((_, i) => i !== index))) render();
      })]));
    document.querySelector("#clearRecentSearches").hidden = !history.length;
    refreshIcons();
  }

  function removeCategoryPins() {
    categoryOverlays.forEach(overlay => overlay.setMap(null));
    categoryOverlays = [];
  }

  function clearCategory() {
    const hadCategory = Boolean(activeCategory);
    activeCategory = null;
    requestId += 1;
    removeCategoryPins();
    els.searchPanel.classList.remove("is-browsing-category");
    document.querySelectorAll("[data-nearby-category]").forEach(button => button.setAttribute("aria-pressed", "false"));
    document.querySelector("#clearNearbyCategory").hidden = true;
    document.querySelector("#nearbyMapStatus").hidden = true;
    message();
    if (hadCategory) renderMapMarkers?.();
  }

  function renderCategoryPins(matches, code) {
    removeCategoryPins();
    matches.forEach(place => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `nearby-place-pin category-${code.toLowerCase()}`;
      button.setAttribute("aria-label", `${place.name} 주변 주차장 찾기`);
      button.title = place.address || place.name;
      button.innerHTML = `<span class="nearby-pin-symbol"><i data-lucide="${categoryIcons[code]}" aria-hidden="true"></i></span><span class="nearby-pin-label">${escapeHtml(place.name)}</span>`;
      button.addEventListener("click", () => selectSearchSuggestion(place));
      categoryOverlays.push(new window.kakao.maps.CustomOverlay({
        map: state.mainMap, position: new window.kakao.maps.LatLng(place.latitude, place.longitude),
        content: button, xAnchor: 0.5, yAnchor: 1, zIndex: 30
      }));
    });
    refreshIcons();
  }

  async function nearby(button, refresh = false) {
    if (activeCategory === button && !refresh) { clearCategory(); return; }
    const id = ++requestId;
    const label = button.textContent.trim();
    const code = button.dataset.nearbyCategory;
    activeCategory = button;
    editing = null;
    els.searchInput.value = "";
    els.searchInput.blur();
    state.searchSuggestionToken += 1;
    window.clearTimeout(state.searchSuggestionTimer);
    state.searchSuggestions = [];
    hideSearchSuggestions();
    update();
    message();
    els.searchPanel.classList.add("is-browsing-category");
    document.querySelectorAll("[data-nearby-category]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    document.querySelector("#clearNearbyCategory").hidden = false;
    document.querySelector("#nearbyMapStatus").hidden = false;
    const count = document.querySelector("#nearbyMapCount");
    count.textContent = `${label} 찾는 중…`;
    removeCategoryPins();
    renderMapMarkers?.();
    try {
      await loadKakaoMapSdk();
      if (!state.mainMap || !window.kakao?.maps?.services?.Places) throw new Error("지도 연결 후 다시 검색해 주세요.");
      const center = state.mainMap?.getCenter();
      const location = center || new window.kakao.maps.LatLng(state.userLocation?.latitude || 37.3919212,
        state.userLocation?.longitude || 127.0583089);
      const places = state.kakaoPlaces || new window.kakao.maps.services.Places();
      const matches = await new Promise((resolve, reject) => places.categorySearch(button.dataset.nearbyCategory,
        (items, result) => {
          if (result === window.kakao.maps.services.Status.OK) resolve(items);
          else if (result === window.kakao.maps.services.Status.ZERO_RESULT) resolve([]);
          else reject(new Error("주변 장소를 불러오지 못했습니다."));
        }, { location, radius: 5000, size: 10, sort: window.kakao.maps.services.SortBy.DISTANCE }));
      if (id !== requestId || activeCategory !== button) return;
      const locations = matches.map(p => ({ id: `place:${p.id}`, name: p.place_name,
        address: p.road_address_name || p.address_name, category: p.category_group_name || label,
        latitude: Number(p.y), longitude: Number(p.x), source: "kakao-place" }))
        .filter(place => Number.isFinite(place.latitude) && Number.isFinite(place.longitude));
      renderCategoryPins(locations, code);
      if (locations.length > 1) {
        const bounds = new window.kakao.maps.LatLngBounds();
        locations.forEach(place => bounds.extend(new window.kakao.maps.LatLng(place.latitude, place.longitude)));
        const panelHeight = els.searchPanel.getBoundingClientRect().height;
        state.mainMap.setBounds(bounds, Math.min(panelHeight + 28, 300), 60, 80, 60);
      } else if (locations.length === 1) {
        state.mainMap.panTo(new window.kakao.maps.LatLng(locations[0].latitude, locations[0].longitude));
      }
      count.textContent = locations.length ? `주변 ${label} ${locations.length}곳` : `주변 5km 내 ${label} 없음`;
    } catch (_) {
      if (id === requestId) count.textContent = "주변 장소를 불러오지 못했어요. 다시 검색해 주세요.";
    }
  }

  window.ParkViewSearch = {
    open, close, clearCategory, hasCategory: () => Boolean(activeCategory),
    inputChanged() { clearCategory(); message(editing ? `${editing.label}로 저장할 장소를 선택하세요.` : ""); open(); },
    acceptPlace(place) {
      if (!editing) return false;
      const target = editing;
      const places = read(PLACES_KEY).filter(p => p.key !== target.key);
      if (!write(PLACES_KEY, [...places, { ...placeData(place), key: target.key }])) return true;
      editing = null;
      resetMapSearch();
      open();
      message(`${target.label} 장소를 저장했습니다.`);
      return true;
    },
    selected(place) {
      clearCategory();
      const history = read(RECENT_KEY).filter(p => !(p.name === place.name
        && Math.abs(p.latitude - place.latitude) < 0.0001 && Math.abs(p.longitude - place.longitude) < 0.0001));
      write(RECENT_KEY, [placeData(place), ...history].slice(0, 8));
      close();
      els.searchInput.blur();
    }
  };

  {
    panel = document.querySelector("#searchDiscovery");
    home = document.querySelector("#discoveryHome");
    title = document.querySelector("#discoveryTitle");
    status = document.querySelector("#discoveryStatus");
    document.querySelector("#discoveryClose").addEventListener("click", () => {
      if (editing) { editing = null; resetMapSearch(); open(); message(); }
      else { close(); els.searchInput.blur(); }
    });
    document.querySelectorAll("[data-nearby-category]").forEach(button => button.addEventListener("click", () => nearby(button)));
    document.querySelector("#clearNearbyCategory").addEventListener("click", clearCategory);
    document.querySelector("#refreshNearbyCategory").addEventListener("click", () => { if (activeCategory) nearby(activeCategory, true); });
    document.querySelector("#addSavedPlace").addEventListener("click", () => startSaving(`place:${Date.now()}`, "자주 가는 장소"));
    document.querySelector("#clearRecentSearches").addEventListener("click", () => { if (write(RECENT_KEY, [])) render(); });
    document.querySelector("#discoveryAllFavorites").addEventListener("click", () => { close(); showFavoriteLotsFromMenu(); });
    document.addEventListener("click", event => {
      if (!event.composedPath().includes(els.searchPanel)) close();
    });
  }
};

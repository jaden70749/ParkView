const KOREA_BOUNDS = {
  minLat: 33.0,
  maxLat: 38.9,
  minLng: 124.5,
  maxLng: 131.9
};

const EDGE_API_BASE_URL = String(
  window.PARKVIEW_CONFIG?.edgeApiBaseUrl || ""
).trim().replace(/\/+$/, "");

function edgeApiUrl(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${EDGE_API_BASE_URL}${normalizedPath}`;
}

async function loadRuntimeConfig() {
  const staticKey = String(
    window.PARKVIEW_CONFIG?.kakaoJavaScriptKey || ""
  ).trim();
  const staticConfig = {
    mapProvider: staticKey ? "kakao" : "fallback",
    kakaoJavaScriptKey: staticKey,
    kakaoConfigured: Boolean(staticKey),
    geminiConfigured: false
  };

  // GitHub Pages has no Python API. Its deployment workflow injects only the
  // public Kakao JavaScript key into config.js.
  if (staticConfig.kakaoConfigured && !EDGE_API_BASE_URL) {
    state.runtimeConfig = staticConfig;
    return state.runtimeConfig;
  }

  try {
    const response = await fetch(edgeApiUrl("/api/public-config"), {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const serverConfig = await response.json();
    const kakaoJavaScriptKey = String(
      serverConfig.kakaoJavaScriptKey || staticConfig.kakaoJavaScriptKey
    ).trim();
    state.runtimeConfig = {
      ...staticConfig,
      ...serverConfig,
      mapProvider: kakaoJavaScriptKey ? "kakao" : "fallback",
      kakaoJavaScriptKey,
      kakaoConfigured: Boolean(kakaoJavaScriptKey)
    };
  } catch (error) {
    state.runtimeConfig = staticConfig;
    console.warn("Runtime configuration unavailable.", error);
  }
  return state.runtimeConfig;
}

function loadKakaoMapSdk() {
  if (window.kakao?.maps?.Map) return Promise.resolve(window.kakao.maps);
  if (state.kakaoSdkPromise) return state.kakaoSdkPromise;
  const appKey = String(state.runtimeConfig?.kakaoJavaScriptKey || "").trim();
  if (!appKey) return Promise.reject(new Error("KAKAO_JAVASCRIPT_KEY is not configured"));

  state.kakaoSdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false&libraries=services`;
    script.async = true;
    script.addEventListener("load", () => {
      if (!window.kakao?.maps?.load) {
        reject(new Error("Kakao Maps SDK domain or app key is invalid"));
        return;
      }
      window.kakao.maps.load(() => resolve(window.kakao.maps));
    }, { once: true });
    script.addEventListener("error", () => reject(new Error("Kakao Maps SDK could not be loaded")), { once: true });
    document.head.appendChild(script);
  });
  return state.kakaoSdkPromise;
}

const MAP_MARKER_MIN_ZOOM = 13;
const MAP_MARKER_DETAIL_ZOOM = 16;
const COMPACT_MARKER_CELL_SIZE = 110;
const KAKAO_PLACE_SEARCH_DEBOUNCE_MS = 320;
const MAIN_MAP_MIN_ZOOM = 6;
const MAIN_MAP_MAX_ZOOM = 18;
const KAKAO_ZOOM_LEVEL_OFFSET = 19;
const DEFAULT_MAP_CENTER = [36.25, 127.8];
const DEFAULT_MAP_ZOOM = 7;
const FALLBACK_MAP_MIN_SCALE = 0.55;
const DEFAULT_FALLBACK_SCALE = 1.35;
const VERIFIED_ADDRESS_LOCATIONS = [
  {
    address: "경기도 성남시 분당구 하오개로351번길 4",
    aliases: [
      "경기도 성남시 분당구 하오개로351번길 4",
      "경기 성남시 분당구 하오개로351번길 4",
      "성남시 분당구 하오개로351번길 4"
    ],
    latitude: 37.3919212,
    longitude: 127.0583089
  }
];
const REGISTERED_LOTS_STORAGE = "parkview.registeredLots.v1";
const FAVORITE_LOTS_STORAGE = "parkview.favoriteLots.v1";
const DEFAULT_PLAN_INSTRUCTION = "아크릴 주차장 사진을 보고 일반 주차면, 장애인 주차면, 임산부 주차면, 중앙 통로가 보이도록 깨끗한 2D 도면을 만들어줘.";
const SETUP_STEPS = ["plan", "detect", "review"];
const REGISTRATION_STEPS = [
  { id: "info", title: "기본 정보", next: "위치 지정" },
  { id: "location", title: "지도 위치", next: "도면 만들기" },
  { id: "plan", title: "AI 도면 생성", next: "등록 확인" },
  { id: "review", title: "등록 확인", next: "지도에 주차장 추가" }
];
const SAMPLE_LOTS = [
  { id: "oakwood", name: "오크우드 강남 호텔 주차장", address: "서울 강남구 테헤란로87길", distanceMeters: 123, hourlyPrice: 15000, isOpen: true, latitude: 37.5108, longitude: 127.0582, totalSpaces: 55, availableSpaces: 11 },
  { id: "kakao", name: "카카오 T 삼성동 주차장", address: "서울 강남구 삼성동", distanceMeters: 154, hourlyPrice: 5000, isOpen: true, latitude: 37.5076, longitude: 127.0632, totalSpaces: 250, availableSpaces: 24 },
  { id: "parkin", name: "PARKIN 금강타워3 민영 주차장", address: "서울 강남구 봉은사로", distanceMeters: 234, hourlyPrice: 14000, isOpen: true, latitude: 37.5117, longitude: 127.0485, totalSpaces: 120, availableSpaces: 81 },
  { id: "ktg", name: "투루파킹 KT&G대치 주차장", address: "서울 강남구 영동대로", distanceMeters: 333, hourlyPrice: 4500, isOpen: true, latitude: 37.5067, longitude: 127.0657, totalSpaces: 85, availableSpaces: 20 },
  { id: "ibis", name: "이비스스타일 호텔 주차장", address: "서울 강남구 삼성로", distanceMeters: 375, hourlyPrice: 22000, isOpen: false, latitude: 37.5050, longitude: 127.0571, totalSpaces: 55, availableSpaces: 1 }
];

const state = {
  lots: [],
  publicLots: [],
  registeredLots: [],
  kakaoLots: [],
  filteredLots: [],
  selectedLot: null,
  floorIndex: 0,
  slots: [],
  floors: makeFloors(3),
  rois: [],
  planImages: [],
  baselineMetrics: new Map(),
  currentImage: null,
  detections: [],
  emptyYoloStreak: 0,
  setupStep: "plan",
  adminView: "home",
  registrationStep: 0,
  edgeStatusTimer: null,
  runtimeConfig: null,
  mapMode: "fallback",
  mainMap: null,
  mainMarkerOverlays: [],
  currentLocationMarker: null,
  userLocation: null,
  searchLocationMarker: null,
  registrationMapInstance: null,
  registrationMarker: null,
  registrationLocation: null,
  registrationGeocodeToken: 0,
  kakaoSdkPromise: null,
  kakaoGeocoder: null,
  kakaoPlaces: null,
  kakaoPlaceSearchTimer: null,
  kakaoPlaceSearchToken: 0,
  kakaoLastPlaceSearchKey: "",
  mapSearchKeyword: "",
  searchSuggestionTimer: null,
  searchSuggestionToken: 0,
  searchSuggestions: [],
  searchSuggestionIndex: -1,
  filters: {
    openOnly: false,
    availableOnly: false,
    fee: "all",
    types: new Set(),
    favoritesOnly: false
  },
  searchFeedbackTimer: null,
  voiceRecognition: null,
  transform: { x: 0, y: 0, scale: 1 },
  dragging: null,
  pinch: null,
  pointers: new Map(),
  sheetDrag: null,
  sheetHeight: null,
  favoriteLotIds: new Set()
};

const els = {};

document.addEventListener("DOMContentLoaded", async () => {
  bindElements();
  bindEvents();
  refreshIcons();
  setLocateLoading(true);
  setSearchFeedback("현재 위치를 확인하고 있습니다.", false, 9000);
  const initialLocationPromise = getCurrentCoordinates();
  state.favoriteLotIds = loadFavoriteLotIds();
  state.publicLots = await loadLots();
  state.registeredLots = loadRegisteredLots();
  mergeParkingLotSources();
  state.selectedLot = state.lots[0] || SAMPLE_LOTS[0];
  state.floors = state.selectedLot.floors;
  syncFilterControls();
  updateMenuFavoriteCount();
  await loadRuntimeConfig();
  await loadKakaoMapSdk().catch((error) => {
    console.warn("Kakao Maps SDK unavailable; using fallback map.", error);
  });
  initializeMainMap();
  renderList();
  renderAdminFloor();
  renderRegisteredLots();
  setRegistrationStep(0);
  registerServiceWorker();
  initialLocationPromise.then((location) => {
    setLocateLoading(false);
    if (!location) {
      setSearchFeedback("위치 권한을 허용하면 내 주변 주차장을 볼 수 있습니다.", true);
      return;
    }
    applyUserLocation(location, true);
    setSearchFeedback("현재 위치 주변 주차장을 표시합니다.");
  });
});

function bindElements() {
  Object.assign(els, {
    userScreen: document.querySelector("#userScreen"),
    adminScreen: document.querySelector("#adminScreen"),
    setupPanels: document.querySelectorAll("[data-setup-panel]"),
    prevSetupButton: document.querySelector("#prevSetupButton"),
    nextSetupButton: document.querySelector("#nextSetupButton"),
    mapStage: document.querySelector("#mapStage"),
    realMap: document.querySelector("#realMap"),
    mapWorld: document.querySelector("#mapWorld"),
    markerLayer: document.querySelector("#markerLayer"),
    topControls: document.querySelector("#topControls"),
    searchPanel: document.querySelector(".search-panel"),
    searchInput: document.querySelector("#searchInput"),
    searchSuggestions: document.querySelector("#searchSuggestions"),
    searchFeedback: document.querySelector("#searchFeedback"),
    mapZoomNotice: document.querySelector("#mapZoomNotice"),
    mapZoomInButton: document.querySelector("#mapZoomInButton"),
    mapZoomOutButton: document.querySelector("#mapZoomOutButton"),
    mapNorthButton: document.querySelector("#mapNorthButton"),
    mapLocateButton: document.querySelector("#mapLocateButton"),
    menuButton: document.querySelector("#menuButton"),
    menuCloseButton: document.querySelector("#menuCloseButton"),
    menuScrim: document.querySelector("#menuScrim"),
    mainMenu: document.querySelector("#mainMenu"),
    menuAllLots: document.querySelector("#menuAllLots"),
    menuFavorites: document.querySelector("#menuFavorites"),
    menuFavoriteCount: document.querySelector("#menuFavoriteCount"),
    menuCurrentLocation: document.querySelector("#menuCurrentLocation"),
    voiceSearchButton: document.querySelector("#voiceSearchButton"),
    filterButton: document.querySelector("#filterButton"),
    filterPanel: document.querySelector("#filterPanel"),
    filterCloseButton: document.querySelector("#filterCloseButton"),
    filterResetButton: document.querySelector("#filterResetButton"),
    filterOpenOnly: document.querySelector("#filterOpenOnly"),
    filterAvailableOnly: document.querySelector("#filterAvailableOnly"),
    feeFilterInputs: document.querySelectorAll('input[name="feeFilter"]'),
    parkingTypeFilterInputs: document.querySelectorAll('input[name="parkingTypeFilter"]'),
    quickFilterButtons: document.querySelectorAll("[data-quick-filter]"),
    applyFilterButton: document.querySelector("#applyFilterButton"),
    adminButton: document.querySelector("#adminButton"),
    userButton: document.querySelector("#userButton"),
    adminEyebrow: document.querySelector("#adminEyebrow"),
    adminTitle: document.querySelector("#adminTitle"),
    adminHomeView: document.querySelector("#adminHomeView"),
    registrationView: document.querySelector("#registrationView"),
    managementView: document.querySelector("#managementView"),
    deleteLotButton: document.querySelector("#deleteLotButton"),
    newLotButton: document.querySelector("#newLotButton"),
    registeredLotList: document.querySelector("#registeredLotList"),
    registrationPanels: document.querySelectorAll("[data-registration-step]"),
    registrationStepCount: document.querySelector("#registrationStepCount"),
    registrationStepTitle: document.querySelector("#registrationStepTitle"),
    registrationProgressBar: document.querySelector("#registrationProgressBar"),
    registrationCancelButton: document.querySelector("#registrationCancelButton"),
    registrationBackButton: document.querySelector("#registrationBackButton"),
    registrationNextButton: document.querySelector("#registrationNextButton"),
    registerName: document.querySelector("#registerName"),
    registerAddress: document.querySelector("#registerAddress"),
    registerParkingType: document.querySelector("#registerParkingType"),
    registerFeeInfo: document.querySelector("#registerFeeInfo"),
    registerHourlyPrice: document.querySelector("#registerHourlyPrice"),
    registerOpenStatus: document.querySelector("#registerOpenStatus"),
    registerWeekdayStart: document.querySelector("#registerWeekdayStart"),
    registerWeekdayEnd: document.querySelector("#registerWeekdayEnd"),
    registerPaymentSupport: document.querySelector("#registerPaymentSupport"),
    registerPhone: document.querySelector("#registerPhone"),
    registrationInfoError: document.querySelector("#registrationInfoError"),
    registrationMap: document.querySelector("#registrationMap"),
    registrationLocationLabel: document.querySelector("#registrationLocationLabel"),
    registerLatitude: document.querySelector("#registerLatitude"),
    registerLongitude: document.querySelector("#registerLongitude"),
    registerTotalSpaces: document.querySelector("#registerTotalSpaces"),
    registerDisabledSpaces: document.querySelector("#registerDisabledSpaces"),
    registerPregnantSpaces: document.querySelector("#registerPregnantSpaces"),
    lotRegistrationSummary: document.querySelector("#lotRegistrationSummary"),
    managementBackButton: document.querySelector("#managementBackButton"),
    managementLotName: document.querySelector("#managementLotName"),
    managementLotAddress: document.querySelector("#managementLotAddress"),
    managementSummary: document.querySelector("#managementSummary"),
    managementFloorName: document.querySelector("#managementFloorName"),
    managementFloorPlan: document.querySelector("#managementFloorPlan"),
    managePrevFloor: document.querySelector("#managePrevFloor"),
    manageNextFloor: document.querySelector("#manageNextFloor"),
    cameraConnectionChip: document.querySelector("#cameraConnectionChip"),
    bottomSheet: document.querySelector("#bottomSheet"),
    sheetHandle: document.querySelector("#sheetHandle"),
    sheetTitle: document.querySelector("#sheetTitle"),
    listView: document.querySelector("#listView"),
    detailView: document.querySelector("#detailView"),
    lotList: document.querySelector("#lotList"),
    lotDetail: document.querySelector("#lotDetail"),
    backToList: document.querySelector("#backToList"),
    cameraStatus: document.querySelector("#cameraStatus"),
    analysisStatus: document.querySelector("#analysisStatus"),
    objectStatus: document.querySelector("#objectStatus"),
    planImages: document.querySelector("#planImages"),
    planUploadBox: document.querySelector("#planUploadBox"),
    planImageCount: document.querySelector("#planImageCount"),
    planImagePreview: document.querySelector("#planImagePreview"),
    geminiStatus: document.querySelector("#geminiStatus"),
    planPrompt: document.querySelector("#planPrompt"),
    floorStart: document.querySelector("#floorStart"),
    floorEnd: document.querySelector("#floorEnd"),
    generatePlanButton: document.querySelector("#generatePlanButton"),
    resetPlanButton: document.querySelector("#resetPlanButton"),
    adminFloorName: document.querySelector("#adminFloorName"),
    adminFloorPlan: document.querySelector("#adminFloorPlan"),
    prevFloor: document.querySelector("#prevFloor"),
    nextFloor: document.querySelector("#nextFloor")
  });
}

function bindEvents() {
  els.menuButton.addEventListener("click", openMainMenu);
  els.menuCloseButton.addEventListener("click", closeMainMenu);
  els.menuScrim.addEventListener("click", closeMainMenu);
  els.menuAllLots.addEventListener("click", showAllLotsFromMenu);
  els.menuFavorites.addEventListener("click", showFavoriteLotsFromMenu);
  els.menuCurrentLocation.addEventListener("click", focusOnCurrentLocation);
  els.adminButton.addEventListener("click", () => {
    closeMainMenu();
    openAdminHome();
  });
  els.voiceSearchButton.addEventListener("click", startVoiceSearch);
  els.mapZoomInButton?.addEventListener("click", () => changeMapZoom(1));
  els.mapZoomOutButton?.addEventListener("click", () => changeMapZoom(-1));
  els.mapNorthButton?.addEventListener("click", resetMapNorth);
  els.mapLocateButton?.addEventListener("click", focusOnCurrentLocation);
  els.filterButton.addEventListener("click", openFilterPanel);
  els.filterCloseButton.addEventListener("click", closeFilterPanel);
  els.filterResetButton.addEventListener("click", resetFilterControls);
  els.applyFilterButton.addEventListener("click", applyFilterPanel);
  [...els.feeFilterInputs, ...els.parkingTypeFilterInputs, els.filterOpenOnly, els.filterAvailableOnly]
    .forEach((control) => control.addEventListener("change", updateFilterResultCount));
  els.quickFilterButtons.forEach((button) => {
    button.addEventListener("click", () => toggleQuickFilter(button.dataset.quickFilter));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!els.searchSuggestions.hidden) hideSearchSuggestions();
    else if (els.filterPanel.classList.contains("is-open")) closeFilterPanel();
    else if (els.mainMenu.classList.contains("is-open")) closeMainMenu();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".search-panel")) hideSearchSuggestions();
  });
  els.userButton?.addEventListener("click", () => showScreen("user"));
  els.prevSetupButton?.addEventListener("click", () => moveSetupStep(-1));
  els.nextSetupButton?.addEventListener("click", () => moveSetupStep(1));
  els.sheetHandle.addEventListener("pointerdown", onSheetPointerDown);
  els.sheetHandle.addEventListener("pointermove", onSheetPointerMove);
  els.sheetHandle.addEventListener("pointerup", onSheetPointerUp);
  els.sheetHandle.addEventListener("pointercancel", onSheetPointerUp);
  els.sheetHandle.addEventListener("keydown", onSheetHandleKeyDown);
  els.sheetHandle.addEventListener("dblclick", expandBottomSheetToFull);
  els.backToList.addEventListener("click", showListView);
  els.newLotButton?.addEventListener("click", startLotRegistration);
  els.registrationCancelButton?.addEventListener("click", openAdminHome);
  els.registrationBackButton?.addEventListener("click", () => moveRegistrationStep(-1));
  els.registrationNextButton?.addEventListener("click", () => moveRegistrationStep(1));
  els.managementBackButton?.addEventListener("click", openAdminHome);
  els.deleteLotButton?.addEventListener("click", deleteSelectedLot);
  els.registerName?.addEventListener("input", () => {
    if (els.registrationInfoError) els.registrationInfoError.textContent = "";
  });
  els.registerAddress?.addEventListener("input", () => {
    if (els.registrationInfoError) els.registrationInfoError.textContent = "";
    state.registrationLocation = null;
  });
  els.registerFeeInfo?.addEventListener("change", syncRegistrationFeeFields);

  els.searchInput.addEventListener("input", handleSearchInput);
  els.searchInput.addEventListener("focus", () => {
    if (state.searchSuggestions.length && els.searchInput.value.trim()) renderSearchSuggestions();
  });
  els.searchInput.addEventListener("keydown", onSearchInputKeyDown);
  els.searchInput.addEventListener("search", () => {
    if (!els.searchInput.value.trim()) resetMapSearch();
  });

  els.mapStage.addEventListener("pointerdown", onPointerDown);
  els.mapStage.addEventListener("pointermove", onPointerMove);
  els.mapStage.addEventListener("pointerup", onPointerUp);
  els.mapStage.addEventListener("pointercancel", onPointerUp);
  els.mapStage.addEventListener("wheel", onWheel, { passive: false });
  els.mapStage.addEventListener("click", onFallbackMapClick);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopEdgeStatusPolling();
    } else if (els.managementView?.classList.contains("active")) {
      startEdgeStatusPolling();
    }
  });
  els.planImages?.addEventListener("change", handlePlanImageUpload);
  els.planUploadBox?.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.planUploadBox.classList.add("dragging");
  });
  els.planUploadBox?.addEventListener("dragleave", () => {
    els.planUploadBox.classList.remove("dragging");
  });
  els.planUploadBox?.addEventListener("drop", async (event) => {
    event.preventDefault();
    els.planUploadBox.classList.remove("dragging");
    await handlePlanFiles(Array.from(event.dataTransfer.files || []));
  });
  els.generatePlanButton?.addEventListener("click", generatePlanFromPrompt);
  els.resetPlanButton?.addEventListener("click", () => {
    state.floors = makeFloors(3);
    state.floorIndex = 0;
    renderAdminFloor();
  });
  els.prevFloor?.addEventListener("click", () => {
    state.floorIndex = Math.max(0, state.floorIndex - 1);
    state.detections = [];
    renderAdminFloor();
  });
  els.nextFloor?.addEventListener("click", () => {
    state.floorIndex = Math.min(state.floors.length - 1, state.floorIndex + 1);
    state.detections = [];
    renderAdminFloor();
  });
  els.managePrevFloor?.addEventListener("click", () => {
    state.floorIndex = Math.max(0, state.floorIndex - 1);
    state.detections = [];
    renderManagementFloor();
  });
  els.manageNextFloor?.addEventListener("click", () => {
    state.floorIndex = Math.min(state.floors.length - 1, state.floorIndex + 1);
    state.detections = [];
    renderManagementFloor();
  });
}

function refreshIcons() {
  window.lucide?.createIcons({
    attrs: {
      "aria-hidden": "true"
    }
  });
}

function makeDefaultFilters() {
  return {
    openOnly: false,
    availableOnly: false,
    fee: "all",
    types: new Set(),
    favoritesOnly: false
  };
}

function openMainMenu() {
  closeFilterPanel();
  updateMenuFavoriteCount();
  els.mainMenu.classList.add("is-open");
  els.menuScrim.classList.add("is-open");
  els.mainMenu.setAttribute("aria-hidden", "false");
  els.menuScrim.setAttribute("aria-hidden", "false");
  els.menuButton.setAttribute("aria-expanded", "true");
  window.setTimeout(() => els.menuCloseButton.focus(), 220);
}

function closeMainMenu() {
  els.mainMenu.classList.remove("is-open");
  els.menuScrim.classList.remove("is-open");
  els.mainMenu.setAttribute("aria-hidden", "true");
  els.menuScrim.setAttribute("aria-hidden", "true");
  els.menuButton.setAttribute("aria-expanded", "false");
}

function updateMenuFavoriteCount() {
  if (!els.menuFavoriteCount) return;
  els.menuFavoriteCount.textContent = `저장한 주차장 ${state.favoriteLotIds.size.toLocaleString("ko-KR")}개`;
}

function showAllLotsFromMenu() {
  closeMainMenu();
  els.searchInput.value = "";
  state.mapSearchKeyword = "";
  state.filters = makeDefaultFilters();
  syncFilterControls();
  showListView();
  applyCurrentFilters();
  setSearchFeedback("전체 주차장을 표시합니다.");
}

function showFavoriteLotsFromMenu() {
  closeMainMenu();
  els.searchInput.value = "";
  state.mapSearchKeyword = "";
  state.filters = makeDefaultFilters();
  state.filters.favoritesOnly = true;
  syncFilterControls();
  showListView();
  applyCurrentFilters();
  setSearchFeedback(state.filteredLots.length ? "즐겨찾는 주차장만 표시합니다." : "아직 즐겨찾는 주차장이 없습니다.", !state.filteredLots.length);
}

function getCurrentCoordinates() {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 60000, maximumAge: 30000 }
    );
  });
}

function applyUserLocation(location, focusMap = false) {
  state.userLocation = {
    latitude: Number(location.latitude),
    longitude: Number(location.longitude)
  };
  updateCurrentLocationMarker(state.userLocation.latitude, state.userLocation.longitude);
  if (focusMap) focusMapOn(state.userLocation.latitude, state.userLocation.longitude, 16);
  refreshNearbyList();
  renderList();
  if (els.detailView.classList.contains("active") && state.selectedLot) {
    renderLotDetail(state.selectedLot);
  }
}

async function focusOnCurrentLocation() {
  closeMainMenu();
  if (!navigator.geolocation) {
    setSearchFeedback("이 기기에서는 현재 위치를 확인할 수 없습니다.", true);
    return;
  }
  setLocateLoading(true);
  setSearchFeedback("현재 위치를 확인하고 있습니다.", false, 9000);
  const location = await getCurrentCoordinates();
  setLocateLoading(false);
  if (!location) {
    setSearchFeedback("위치 권한을 허용하면 내 주변 주차장을 볼 수 있습니다.", true);
    return;
  }
  applyUserLocation(location, true);
  setSearchFeedback("현재 위치 주변 주차장으로 이동했습니다.");
}

function setLocateLoading(loading) {
  if (!els.mapLocateButton) return;
  els.mapLocateButton.classList.toggle("is-locating", loading);
  els.mapLocateButton.disabled = loading;
  els.mapLocateButton.setAttribute("aria-busy", String(loading));
}

function updateCurrentLocationMarker(latitude, longitude) {
  if (state.mapMode !== "kakao" || !state.mainMap || !window.kakao?.maps) return;
  const latlng = new window.kakao.maps.LatLng(latitude, longitude);
  if (state.currentLocationMarker) {
    state.currentLocationMarker.setPosition(latlng);
    return;
  }
  const content = document.createElement("span");
  content.className = "current-location-dot";
  content.setAttribute("aria-hidden", "true");
  state.currentLocationMarker = new window.kakao.maps.CustomOverlay({
    map: state.mainMap,
    position: latlng,
    content,
    xAnchor: 0.5,
    yAnchor: 0.5,
    zIndex: 20
  });
}

function changeMapZoom(direction) {
  if (state.mapMode === "kakao" && state.mainMap) {
    const targetZoom = clamp(mainMapZoom() + direction, MAIN_MAP_MIN_ZOOM, MAIN_MAP_MAX_ZOOM);
    state.mainMap.setLevel(kakaoLevelFromZoom(targetZoom), { animate: true });
    updateMapNavigationControls();
    return;
  }
  const rect = els.mapStage.getBoundingClientRect();
  const center = visibleMapCenterPoint();
  const factor = direction > 0 ? 1.45 : 1 / 1.45;
  zoomAt(rect.left + center.x, rect.top + center.y, state.transform.scale * factor);
  updateMapNavigationControls();
}

function resetMapNorth() {
  if (!els.mapNorthButton) return;
  els.mapNorthButton.classList.remove("is-resetting");
  void els.mapNorthButton.offsetWidth;
  els.mapNorthButton.classList.add("is-resetting");
  window.setTimeout(() => els.mapNorthButton.classList.remove("is-resetting"), 260);
  setSearchFeedback("북쪽을 위로 정렬했습니다.");
}

function updateMapNavigationControls() {
  if (!els.mapZoomInButton || !els.mapZoomOutButton) return;
  if (state.mapMode === "kakao" && state.mainMap) {
    const zoom = mainMapZoom();
    els.mapZoomInButton.disabled = zoom >= MAIN_MAP_MAX_ZOOM;
    els.mapZoomOutButton.disabled = zoom <= MAIN_MAP_MIN_ZOOM;
    return;
  }
  els.mapZoomInButton.disabled = state.transform.scale >= 8;
  els.mapZoomOutButton.disabled = state.transform.scale <= FALLBACK_MAP_MIN_SCALE;
}

function startVoiceSearch() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    els.searchInput.focus();
    setSearchFeedback("이 브라우저에서는 음성 검색을 지원하지 않습니다.", true);
    return;
  }
  state.voiceRecognition?.abort?.();
  const recognition = new SpeechRecognition();
  state.voiceRecognition = recognition;
  recognition.lang = "ko-KR";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => {
    els.voiceSearchButton.classList.add("is-listening");
    els.voiceSearchButton.setAttribute("aria-pressed", "true");
    setSearchFeedback("검색할 장소를 말씀해 주세요.", false, 10000);
  };
  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript?.trim();
    if (!transcript) return;
    els.searchInput.value = transcript;
    handleSearchInput();
    searchMapLocation();
  };
  recognition.onerror = () => setSearchFeedback("음성을 인식하지 못했습니다. 다시 시도해 주세요.", true);
  recognition.onend = () => {
    els.voiceSearchButton.classList.remove("is-listening");
    els.voiceSearchButton.setAttribute("aria-pressed", "false");
    state.voiceRecognition = null;
  };
  try {
    recognition.start();
  } catch {
    setSearchFeedback("음성 검색을 시작하지 못했습니다.", true);
  }
}

function setSearchFeedback(message, isError = false, duration = 2400) {
  window.clearTimeout(state.searchFeedbackTimer);
  els.searchFeedback.textContent = message;
  els.searchFeedback.classList.toggle("is-error", isError);
  els.searchFeedback.hidden = false;
  state.searchFeedbackTimer = window.setTimeout(() => {
    els.searchFeedback.hidden = true;
  }, duration);
}

function openFilterPanel() {
  closeMainMenu();
  syncFilterControls();
  updateFilterResultCount();
  els.filterPanel.classList.add("is-open");
  els.filterPanel.setAttribute("aria-hidden", "false");
  els.filterButton.setAttribute("aria-expanded", "true");
  window.setTimeout(() => els.filterCloseButton.focus(), 240);
}

function closeFilterPanel() {
  els.filterPanel.classList.remove("is-open");
  els.filterPanel.setAttribute("aria-hidden", "true");
  els.filterButton.setAttribute("aria-expanded", "false");
}

function syncFilterControls() {
  els.filterOpenOnly.checked = state.filters.openOnly;
  els.filterAvailableOnly.checked = state.filters.availableOnly;
  els.feeFilterInputs.forEach((input) => {
    input.checked = input.value === state.filters.fee;
  });
  els.parkingTypeFilterInputs.forEach((input) => {
    input.checked = state.filters.types.has(input.value);
  });
  updateQuickFilterButtons();
  updateFilterResultCount();
}

function resetFilterControls() {
  els.filterOpenOnly.checked = false;
  els.filterAvailableOnly.checked = false;
  els.feeFilterInputs.forEach((input) => {
    input.checked = input.value === "all";
  });
  els.parkingTypeFilterInputs.forEach((input) => {
    input.checked = false;
  });
  updateFilterResultCount();
}

function readFilterControls() {
  return {
    openOnly: els.filterOpenOnly.checked,
    availableOnly: els.filterAvailableOnly.checked,
    fee: [...els.feeFilterInputs].find((input) => input.checked)?.value || "all",
    types: new Set([...els.parkingTypeFilterInputs].filter((input) => input.checked).map((input) => input.value)),
    favoritesOnly: false
  };
}

function applyFilterPanel() {
  state.filters = readFilterControls();
  closeFilterPanel();
  applyCurrentFilters();
  setSearchFeedback(`${state.filteredLots.length.toLocaleString("ko-KR")}개 주차장을 표시합니다.`);
}

function toggleQuickFilter(name) {
  state.filters.favoritesOnly = false;
  if (name === "open") state.filters.openOnly = !state.filters.openOnly;
  if (name === "available") state.filters.availableOnly = !state.filters.availableOnly;
  if (name === "free") state.filters.fee = state.filters.fee === "free" ? "all" : "free";
  syncFilterControls();
  applyCurrentFilters();
}

function updateQuickFilterButtons() {
  els.quickFilterButtons.forEach((button) => {
    const name = button.dataset.quickFilter;
    const active = name === "open"
      ? state.filters.openOnly
      : name === "available"
        ? state.filters.availableOnly
        : state.filters.fee === "free";
    button.setAttribute("aria-pressed", String(active));
  });
  els.filterButton.classList.toggle("has-filter", hasActiveLotFilters());
}

function updateFilterResultCount() {
  if (!els.applyFilterButton) return;
  const filters = readFilterControls();
  const count = filterLotCollection(state.lots, els.searchInput?.value || "", filters).length;
  els.applyFilterButton.textContent = count
    ? `${count.toLocaleString("ko-KR")}개 주차장 보기`
    : "조건에 맞는 주차장 없음";
}

function hasActiveLotFilters() {
  return state.filters.openOnly ||
    state.filters.availableOnly ||
    state.filters.fee !== "all" ||
    state.filters.types.size > 0 ||
    state.filters.favoritesOnly;
}

function filterLotCollection(lots, keyword, filters = state.filters) {
  const normalizedKeyword = String(keyword || "").trim().toLowerCase();
  return lots.filter((lot) => {
    if (normalizedKeyword && !`${lot.name} ${lot.address}`.toLowerCase().includes(normalizedKeyword)) return false;
    if (filters.openOnly && !lot.isOpen) return false;
    if (filters.availableOnly && (!hasLiveAvailability(lot) || lot.availableSpaces < 1)) return false;
    if (filters.favoritesOnly && !state.favoriteLotIds.has(String(lot.id))) return false;
    if (filters.fee === "free" && lot.hourlyPrice !== 0) return false;
    if (filters.fee === "3000" && (!Number.isFinite(lot.hourlyPrice) || lot.hourlyPrice > 3000)) return false;
    if (filters.fee === "5000" && (!Number.isFinite(lot.hourlyPrice) || lot.hourlyPrice > 5000)) return false;
    if (filters.types.size > 0 && !filters.types.has(lot.parkingType)) return false;
    return true;
  });
}

function applyCurrentFilters() {
  const keyword = els.searchInput.value.trim();
  state.mapSearchKeyword = keyword.toLowerCase();
  state.filteredLots = filterLotCollection(state.lots, keyword);
  updateQuickFilterButtons();
  updateSheetTitle();
  renderMapMarkers();
  renderList();
}

function updateSheetTitle() {
  if (!els.sheetTitle) return;
  if (state.filters.favoritesOnly) els.sheetTitle.textContent = "즐겨찾기";
  else if (state.mapSearchKeyword) els.sheetTitle.textContent = "검색 결과";
  else if (hasActiveLotFilters()) els.sheetTitle.textContent = "조건에 맞는 주차장";
  else els.sheetTitle.textContent = "주변 주차장";
}

async function loadLots() {
  try {
    const response = await fetch("./data/parking-lots.json");
    const lots = await response.json();
    return lots
      .filter((lot) => Number.isFinite(lot.latitude) && Number.isFinite(lot.longitude))
      .map((lot, index) => normalizeLot(lot, index));
  } catch {
    return SAMPLE_LOTS.map(normalizeLot);
  }
}

function optionalNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeLot(lot, index = 0) {
  const rawTotal = optionalNumber(lot.totalSpaces ?? lot.reportedTotalSpaces);
  const total = Number.isFinite(rawTotal) && rawTotal > 0 ? Math.round(rawTotal) : null;
  const rawAvailable = optionalNumber(lot.availableSpaces ?? lot.reportedAvailableSpaces);
  const isRegistered = lot.isRegistered === true;
  const hasRealtime = lot.hasRealtime === true || (isRegistered && Number.isFinite(rawAvailable));
  const available = hasRealtime && Number.isFinite(rawAvailable)
    ? Math.max(0, total === null ? Math.round(rawAvailable) : Math.min(total, Math.round(rawAvailable)))
    : null;
  const rawPrice = optionalNumber(lot.hourlyPrice);
  const price = Number.isFinite(rawPrice) && rawPrice >= 0 ? Math.round(rawPrice) : null;
  const baseName = String(lot.name || lot.address || `주차장 ${index + 1}`).trim();
  const verifiedLocation = findVerifiedAddressLocation(lot.address);
  const floors = Array.isArray(lot.floors) && lot.floors.length > 0
    ? lot.floors.map(normalizeStoredFloor)
    : isRegistered ? makeFloors(index + 1) : [];
  return {
    id: String(lot.id ?? index),
    name: isRegistered ? baseName : displayName(baseName),
    address: String(lot.address || ""),
    distanceMeters: optionalNumber(lot.distanceMeters),
    hourlyPrice: price,
    parkingType: String(lot.parkingType || (isRegistered ? "민영" : "공영")),
    feeInfo: String(lot.feeInfo || (price === 0 ? "무료" : price === null ? "정보 없음" : "유료")),
    weekdayStart: normalizeTimeValue(lot.weekdayStart, "00:00"),
    weekdayEnd: normalizeTimeValue(lot.weekdayEnd, "23:59"),
    phone: String(lot.phone || "").trim(),
    supportsAppPayment: lot.supportsAppPayment === true || lot.supportsAppPayment === "true",
    isOpen: lot.isOpen !== false,
    latitude: verifiedLocation?.latitude ?? Number(lot.latitude),
    longitude: verifiedLocation?.longitude ?? Number(lot.longitude),
    totalSpaces: total,
    availableSpaces: available,
    hasRealtime,
    source: String(lot.source || (isRegistered ? "parkview" : "public-data")),
    placeUrl: String(lot.placeUrl || ""),
    floors,
    isRegistered
  };
}

function hasLiveAvailability(lot) {
  return lot?.hasRealtime === true &&
    Number.isFinite(lot.availableSpaces) &&
    Number.isFinite(lot.totalSpaces);
}

function availabilityLabel(lot) {
  if (hasLiveAvailability(lot)) return `${lot.availableSpaces}/${lot.totalSpaces}면`;
  if (Number.isFinite(lot?.totalSpaces)) return `총 ${lot.totalSpaces}면`;
  return "면수 정보 없음";
}

function priceLabel(lot, compact = false) {
  if (!Number.isFinite(lot?.hourlyPrice)) {
    const feeType = String(lot?.feeInfo || "").trim();
    if (feeType && feeType !== "정보 없음") {
      return compact ? feeType : `${feeType} · 상세 요금 미확인`;
    }
    return compact ? "요금 미확인" : "요금 정보 없음";
  }
  if (lot.hourlyPrice === 0) return "무료";
  const amount = lot.hourlyPrice.toLocaleString("ko-KR");
  return compact ? `₩${amount}` : `1시간 ₩${amount}`;
}

function mergeParkingLotSources() {
  const registeredIds = new Set(state.registeredLots.map((lot) => String(lot.id)));
  const baseLots = [
    ...state.registeredLots,
    ...state.publicLots.filter((lot) => !registeredIds.has(String(lot.id)))
  ];
  const nearbyKakaoLots = state.kakaoLots.filter((lot) => (
    !baseLots.some((baseLot) => sameParkingLot(baseLot, lot))
  ));

  state.lots = [...baseLots, ...nearbyKakaoLots];
  state.filteredLots = filterLotCollection(state.lots, state.mapSearchKeyword);
  window.PARKVIEW_DATA_STATS = {
    publicData: state.publicLots.length,
    registered: state.registeredLots.length,
    kakaoNearby: nearbyKakaoLots.length,
    currentTotal: state.lots.length
  };
  console.info("[ParkView] parking data", window.PARKVIEW_DATA_STATS);
}

function sameParkingLot(a, b) {
  if (Math.abs(a.latitude - b.latitude) > 0.00035 || Math.abs(a.longitude - b.longitude) > 0.00045) {
    return false;
  }
  const distanceMeters = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1000;
  if (distanceMeters > 30) return false;
  const normalizeName = (value) => String(value || "")
    .toLowerCase()
    .replace(/주차장|공영|민영/g, "")
    .replace(/[^0-9a-z가-힣]/g, "");
  const aName = normalizeName(a.name);
  const bName = normalizeName(b.name);
  if (aName && bName && (aName === bName || aName.includes(bName) || bName.includes(aName))) return true;
  return Boolean(a.address && b.address && a.address === b.address);
}

function normalizeStoredFloor(floor, floorIndex = 0) {
  const slots = Array.isArray(floor?.slots)
    ? floor.slots.map((slot) => ({
      kind: ["normal", "disabled", "pregnant"].includes(slot.kind) ? slot.kind : "normal",
      status: slot.status === "available" ? "available" : "occupied",
      x: Number(slot.x),
      y: Number(slot.y),
      w: Number(slot.w),
      h: Number(slot.h),
      rotation: clamp(Number(slot.rotation) || 0, -180, 180),
      sourcePolygon: normalizeFloorPoints(slot.sourcePolygon, 4).slice(0, 4),
      adjacentSlots: Array.isArray(slot.adjacentSlots)
        ? slot.adjacentSlots.map(Number).filter((value) => Number.isInteger(value) && value > 0).slice(0, 8)
        : []
    })).filter((slot) => [slot.x, slot.y, slot.w, slot.h].every(Number.isFinite))
    : [];
  const elements = Array.isArray(floor?.elements)
    ? floor.elements.map(normalizeGeneratedElement).filter(Boolean)
    : [];
  const outline = normalizeFloorPoints(floor?.outline, 3);
  const zones = Array.isArray(floor?.zones)
    ? floor.zones.map(normalizeGeneratedZone).filter(Boolean)
    : [];
  return {
    name: String(floor?.name || `B${floorIndex + 1}`),
    outline,
    zones,
    elements,
    slots
  };
}

function clonePoints(points) {
  return Array.isArray(points) ? points.map((point) => ({ x: point.x, y: point.y })) : [];
}

function loadRegisteredLots() {
  try {
    const stored = JSON.parse(localStorage.getItem(REGISTERED_LOTS_STORAGE) || "[]");
    return Array.isArray(stored)
      ? stored.map((lot, index) => normalizeLot({ ...lot, isRegistered: true }, index))
        .filter((lot) => Number.isFinite(lot.latitude) && Number.isFinite(lot.longitude))
      : [];
  } catch {
    return [];
  }
}

function saveRegisteredLots() {
  localStorage.setItem(REGISTERED_LOTS_STORAGE, JSON.stringify(state.registeredLots));
}

function normalizeTimeValue(value, fallback) {
  const match = String(value || "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? `${match[1]}:${match[2]}` : fallback;
}

function loadFavoriteLotIds() {
  try {
    const stored = JSON.parse(localStorage.getItem(FAVORITE_LOTS_STORAGE) || "[]");
    return new Set(Array.isArray(stored) ? stored.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveFavoriteLotIds() {
  localStorage.setItem(FAVORITE_LOTS_STORAGE, JSON.stringify([...state.favoriteLotIds]));
}

function displayName(name) {
  const lower = name.toLowerCase();
  if (name.includes("주차") || name.includes("파킹") || lower.includes("parking")) return name;
  return `${name} 공영주차장`;
}

function openAdminHome() {
  setAdminView("home");
  showScreen("admin");
  renderRegisteredLots();
}

function setAdminView(view) {
  state.adminView = view;
  const views = {
    home: els.adminHomeView,
    registration: els.registrationView,
    management: els.managementView
  };
  Object.entries(views).forEach(([name, element]) => {
    element?.classList.toggle("active", name === view);
  });

  stopEdgeStatusPolling();
  if (view === "home") {
    els.adminEyebrow.textContent = "ParkView Admin";
    els.adminTitle.textContent = "주차장 관리";
  } else if (view === "registration") {
    els.adminEyebrow.textContent = "새 주차장";
    els.adminTitle.textContent = "주차장 등록";
  } else {
    els.adminEyebrow.textContent = "ParkView Admin";
    els.adminTitle.textContent = "운영 관리";
    startEdgeStatusPolling();
  }
  els.adminScreen.scrollTop = 0;
}

function renderRegisteredLots() {
  if (!els.registeredLotList) return;
  els.registeredLotList.replaceChildren();

  if (state.registeredLots.length === 0) {
    const empty = document.createElement("div");
    empty.className = "admin-empty-state";
    empty.innerHTML = `
      <strong>아직 등록된 주차장이 없습니다</strong>
      <p>새 주차장을 등록하면 지도와 관리 목록에 함께 추가됩니다.</p>
    `;
    els.registeredLotList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  state.registeredLots.forEach((lot) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "registered-lot-row";
    row.innerHTML = `
      <span>
        <strong>${escapeHtml(lot.name)}</strong>
        <span>${escapeHtml(lot.address)} · ${lot.floors.length}개 층</span>
      </span>
      <em>${lot.availableSpaces}/${lot.totalSpaces}면 ›</em>
    `;
    row.addEventListener("click", () => openLotManagement(lot.id));
    fragment.appendChild(row);
  });
  els.registeredLotList.appendChild(fragment);
}

function startLotRegistration() {
  resetLotRegistration();
  setAdminView("registration");
  setRegistrationStep(0);
}

function resetLotRegistration() {
  els.registerName.value = "";
  els.registerAddress.value = "";
  els.registerParkingType.value = "공영";
  els.registerFeeInfo.value = "유료";
  els.registerHourlyPrice.value = "5000";
  els.registerOpenStatus.value = "open";
  els.registerWeekdayStart.value = "06:00";
  els.registerWeekdayEnd.value = "22:00";
  els.registerPaymentSupport.value = "false";
  els.registerPhone.value = "";
  els.registerLatitude.value = "";
  els.registerLongitude.value = "";
  els.floorStart.value = "B1";
  els.floorEnd.value = "B1";
  els.registerTotalSpaces.value = "";
  els.registerDisabledSpaces.value = "0";
  els.registerPregnantSpaces.value = "0";
  els.registrationInfoError.textContent = "";
  state.floors = makeFloors();
  state.floorIndex = 0;
  state.rois = [];
  state.currentImage = null;
  state.detections = [];
  state.emptyYoloStreak = 0;
  state.registrationLocation = null;
  state.registrationGeocodeToken += 1;
  clearPlanImages();
  els.geminiStatus.textContent = "사진과 입력한 주차면 수를 대조해 층별 도면을 생성합니다.";
  setRegistrationLocationStatus("주소를 입력하면 지도에서 위치를 자동으로 찾습니다.", "idle");
  syncRegistrationFeeFields();
  renderAdminFloor();
}

function syncRegistrationFeeFields() {
  if (!els.registerFeeInfo || !els.registerHourlyPrice) return;
  const isFree = els.registerFeeInfo.value === "무료";
  els.registerHourlyPrice.disabled = isFree;
  if (isFree) els.registerHourlyPrice.value = "0";
  if (!isFree && Number(els.registerHourlyPrice.value) <= 0) {
    els.registerHourlyPrice.value = "5000";
  }
}

function setRegistrationStep(index) {
  state.registrationStep = clamp(index, 0, REGISTRATION_STEPS.length - 1);
  const step = REGISTRATION_STEPS[state.registrationStep];
  els.registrationPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.registrationStep === step.id);
  });
  els.registrationStepCount.textContent = `${state.registrationStep + 1} / ${REGISTRATION_STEPS.length}`;
  els.registrationStepTitle.textContent = step.title;
  els.registrationProgressBar.style.width = `${((state.registrationStep + 1) / REGISTRATION_STEPS.length) * 100}%`;
  els.registrationBackButton.disabled = state.registrationStep === 0;
  els.registrationNextButton.textContent = step.next;

  if (step.id === "review") {
    state.floorIndex = 0;
    renderRegistrationSummary();
    renderAdminFloor();
  }
  if (step.id === "location") {
    window.setTimeout(() => {
      initializeRegistrationMap();
      resolveRegistrationAddress();
    }, 0);
  }
  if (els.registrationView?.classList.contains("active")) els.adminScreen.scrollTop = 0;
}

function moveRegistrationStep(direction) {
  if (direction < 0) {
    setRegistrationStep(state.registrationStep - 1);
    return;
  }
  if (!validateRegistrationStep()) return;
  if (state.registrationStep === REGISTRATION_STEPS.length - 1) {
    saveRegisteredLot();
    return;
  }
  setRegistrationStep(state.registrationStep + 1);
}

function validateRegistrationStep() {
  const step = REGISTRATION_STEPS[state.registrationStep].id;
  if (step === "info") {
    const name = els.registerName.value.trim();
    const address = els.registerAddress.value.trim();
    if (!name || !address) {
      els.registrationInfoError.textContent = "주차장 이름과 주소를 모두 입력해 주세요.";
      return false;
    }
  }
  if (step === "location") {
    if (!state.registrationLocation) {
      setRegistrationLocationStatus("주소 위치를 먼저 확인해 주세요.", "error");
      return false;
    }
  }
  if (step === "plan" && !state.floors.some((floor) => floor.slots.length > 0)) {
    els.geminiStatus.textContent = "사진을 올리고 AI 도면 생성을 먼저 완료해 주세요.";
    return false;
  }
  return true;
}

function renderRegistrationSummary() {
  const slots = state.floors.flatMap((floor) => floor.slots);
  const feeLabel = els.registerFeeInfo.value === "무료"
    ? "무료"
    : `1시간 ${formatWon(Number(els.registerHourlyPrice.value) || 0)}`;
  els.lotRegistrationSummary.innerHTML = `
    <div><span>주차장</span><strong>${escapeHtml(els.registerName.value.trim() || "-")}</strong></div>
    <div><span>층 / 주차면</span><strong>${state.floors.length}층 · ${slots.length}면</strong></div>
    <div><span>요금 / 운영시간</span><strong>${escapeHtml(feeLabel)} · ${escapeHtml(els.registerWeekdayStart.value)}~${escapeHtml(els.registerWeekdayEnd.value)}</strong></div>
  `;
}

function saveRegisteredLot() {
  const floors = state.floors.map((floor) => ({
    name: floor.name,
    outline: clonePoints(floor.outline),
    zones: (floor.zones || []).map((zone) => ({ ...zone, points: clonePoints(zone.points) })),
    elements: (floor.elements || []).map((element) => ({ ...element })),
    slots: floor.slots.map((slot) => ({ ...slot }))
  }));
  const slots = floors.flatMap((floor) => floor.slots);
  const lot = normalizeLot({
    id: `registered-${Date.now()}`,
    name: els.registerName.value.trim(),
    address: els.registerAddress.value.trim(),
    distanceMeters: 80,
    hourlyPrice: Number(els.registerHourlyPrice.value) || 0,
    parkingType: els.registerParkingType.value,
    feeInfo: els.registerFeeInfo.value,
    weekdayStart: els.registerWeekdayStart.value,
    weekdayEnd: els.registerWeekdayEnd.value,
    phone: els.registerPhone.value.trim(),
    supportsAppPayment: els.registerPaymentSupport.value === "true",
    isOpen: els.registerOpenStatus.value === "open",
    latitude: state.registrationLocation.latitude,
    longitude: state.registrationLocation.longitude,
    totalSpaces: slots.length,
    availableSpaces: slots.filter((slot) => slot.kind === "normal" && slot.status === "available").length,
    floors,
    isRegistered: true
  });

  state.registeredLots.unshift(lot);
  state.lots = [lot, ...state.lots.filter((existing) => existing.id !== lot.id)];
  state.filteredLots = state.lots;
  state.selectedLot = lot;
  state.floors = lot.floors;
  state.floorIndex = 0;
  saveRegisteredLots();
  clearPlanImages();
  renderRegisteredLots();
  renderList();
  focusMapOn(lot.latitude, lot.longitude, 16);
  renderMapMarkers();
  showListView();
  showScreen("user");
}

function openLotManagement(lotId) {
  const lot = state.registeredLots.find((candidate) => candidate.id === lotId);
  if (!lot) return;
  state.selectedLot = lot;
  state.floors = lot.floors;
  state.floorIndex = 0;
  state.currentImage = null;
  state.detections = [];
  state.emptyYoloStreak = 0;
  state.rois = [];
  renderManagement();
  showScreen("admin");
  setAdminView("management");
}

function deleteSelectedLot() {
  const lot = state.selectedLot;
  if (!lot?.isRegistered) return;
  const confirmed = window.confirm(`\"${lot.name}\"을(를) 삭제할까요?\n삭제한 주차장은 복구할 수 없습니다.`);
  if (!confirmed) return;

  state.registeredLots = state.registeredLots.filter((candidate) => candidate.id !== lot.id);
  state.lots = state.lots.filter((candidate) => candidate.id !== lot.id);
  state.filteredLots = state.filteredLots.filter((candidate) => candidate.id !== lot.id);
  state.selectedLot = state.filteredLots[0] || state.lots[0] || null;
  state.floors = state.selectedLot?.floors || makeFloors();
  state.floorIndex = 0;
  state.rois = [];
  state.detections = [];
  state.currentImage?.close?.();
  state.currentImage = null;

  saveRegisteredLots();
  renderRegisteredLots();
  renderList();
  renderMapMarkers();
  showListView();
  setAdminView("home");
}

function renderManagement() {
  const lot = state.selectedLot;
  if (!lot || !lot.isRegistered) return;
  els.managementLotName.textContent = lot.name;
  els.managementLotAddress.textContent = lot.address;
  const status = els.managementView.querySelector(".management-status");
  status.textContent = lot.isOpen ? "운영" : "마감";
  status.style.background = lot.isOpen ? "#2fc962" : "#ef3c42";
  els.managementSummary.innerHTML = `
    <div><span>전체 주차면</span><strong>${lot.totalSpaces}면</strong></div>
    <div><span>현재 가능</span><strong>${lot.availableSpaces}면</strong></div>
    <div><span>운영 층</span><strong>${lot.floors.length}개 층</strong></div>
  `;
  renderManagementFloor();
}

function renderManagementFloor() {
  const floor = state.floors[state.floorIndex];
  if (!floor) return;
  els.managementFloorName.textContent = floor.name;
  els.managePrevFloor.disabled = state.floorIndex === 0;
  els.manageNextFloor.disabled = state.floorIndex === state.floors.length - 1;
  renderFloorPlan(els.managementFloorPlan, floor, true);
}

function kakaoLevelFromZoom(zoom) {
  return clamp(KAKAO_ZOOM_LEVEL_OFFSET - zoom, 1, 13);
}

function mainMapZoom() {
  if (state.mapMode !== "kakao" || !state.mainMap) return DEFAULT_MAP_ZOOM;
  return KAKAO_ZOOM_LEVEL_OFFSET - state.mainMap.getLevel();
}

function initializeMainMap(initialLocation = null) {
  const initialLatitude = initialLocation?.latitude ?? DEFAULT_MAP_CENTER[0];
  const initialLongitude = initialLocation?.longitude ?? DEFAULT_MAP_CENTER[1];
  const initialZoom = initialLocation ? 16 : DEFAULT_MAP_ZOOM;
  if (!window.kakao?.maps?.Map || !els.realMap) {
    state.mapMode = "fallback";
    els.realMap?.classList.add("unavailable");
    els.mapWorld?.classList.remove("fallback-map");
    centerMapOn(
      initialLatitude,
      initialLongitude,
      initialLocation ? 4.2 : DEFAULT_FALLBACK_SCALE
    );
    positionMainMapControls();
    updateMapNavigationControls();
    renderMarkers();
    return;
  }

  state.mapMode = "kakao";
  els.realMap.classList.remove("unavailable");
  els.mapWorld?.classList.add("fallback-map");
  state.mainMap = new window.kakao.maps.Map(els.realMap, {
    center: new window.kakao.maps.LatLng(initialLatitude, initialLongitude),
    level: kakaoLevelFromZoom(initialZoom),
    keyboardShortcuts: true
  });
  state.mainMap.setMinLevel(kakaoLevelFromZoom(MAIN_MAP_MAX_ZOOM));
  state.mainMap.setMaxLevel(kakaoLevelFromZoom(MAIN_MAP_MIN_ZOOM));
  window.kakao.maps.event.addListener(state.mainMap, "idle", () => {
    updateMapNavigationControls();
    renderMapMarkers();
    refreshNearbyList();
    scheduleKakaoParkingSearch();
  });
  window.kakao.maps.event.addListener(state.mainMap, "click", hideBottomSheet);
  if (window.ResizeObserver && els.bottomSheet) {
    state.sheetResizeObserver = new ResizeObserver(positionMainMapControls);
    state.sheetResizeObserver.observe(els.bottomSheet);
  }
  window.setTimeout(() => {
    state.mainMap.relayout();
    positionMainMapControls();
    updateMapNavigationControls();
    renderMapMarkers();
    refreshNearbyList();
    scheduleKakaoParkingSearch();
  }, 0);
}

function scheduleKakaoParkingSearch() {
  window.clearTimeout(state.kakaoPlaceSearchTimer);
  if (state.mapMode !== "kakao" || !state.mainMap || mainMapZoom() < MAP_MARKER_MIN_ZOOM) {
    if (state.kakaoLots.length) {
      state.kakaoLots = [];
      state.kakaoLastPlaceSearchKey = "";
      mergeParkingLotSources();
      renderMapMarkers();
      refreshNearbyList();
    }
    return;
  }
  state.kakaoPlaceSearchTimer = window.setTimeout(
    searchVisibleKakaoParkingPlaces,
    KAKAO_PLACE_SEARCH_DEBOUNCE_MS
  );
}

function kakaoPlaceSearchKey() {
  const bounds = state.mainMap.getBounds();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return [
    state.mainMap.getLevel(),
    sw.getLat().toFixed(4),
    sw.getLng().toFixed(4),
    ne.getLat().toFixed(4),
    ne.getLng().toFixed(4)
  ].join(":");
}

function searchVisibleKakaoParkingPlaces() {
  if (!window.kakao?.maps?.services?.Places || !state.mainMap) return;
  const searchKey = kakaoPlaceSearchKey();
  if (searchKey === state.kakaoLastPlaceSearchKey) return;
  state.kakaoLastPlaceSearchKey = searchKey;
  const token = ++state.kakaoPlaceSearchToken;
  const places = state.kakaoPlaces || new window.kakao.maps.services.Places(state.mainMap);
  const results = [];
  state.kakaoPlaces = places;

  const finish = () => {
    if (token !== state.kakaoPlaceSearchToken) return;
    const seenIds = new Set();
    state.kakaoLots = results
      .map(kakaoPlaceToLot)
      .filter((lot) => {
        if (!lot || seenIds.has(lot.id)) return false;
        seenIds.add(lot.id);
        return true;
      });
    mergeParkingLotSources();
    renderMapMarkers();
    refreshNearbyList();
  };

  const callback = (data, status, pagination) => {
    if (token !== state.kakaoPlaceSearchToken) return;
    if (status === window.kakao.maps.services.Status.ZERO_RESULT) {
      finish();
      return;
    }
    if (status !== window.kakao.maps.services.Status.OK) {
      state.kakaoLastPlaceSearchKey = "";
      console.warn("[ParkView] Kakao parking search failed", status);
      return;
    }
    results.push(...data);
    if (pagination?.hasNextPage) {
      pagination.nextPage();
      return;
    }
    finish();
  };

  places.categorySearch("PK6", callback, {
    useMapBounds: true,
    size: 15
  });
}

function kakaoPlaceToLot(place, index) {
  const latitude = Number(place.y);
  const longitude = Number(place.x);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return normalizeLot({
    id: `kakao:${place.id || `${longitude}:${latitude}`}`,
    name: place.place_name,
    address: place.road_address_name || place.address_name,
    phone: place.phone,
    latitude,
    longitude,
    parkingType: "주차장",
    feeInfo: "정보 없음",
    source: "kakao",
    placeUrl: place.place_url,
    hasRealtime: false,
    isOpen: true
  }, index);
}

function fitNationwideMap() {
  if (state.mapMode !== "kakao" || !state.mainMap) return;
  const sheetHeight = visibleBottomSheetHeight();
  const bounds = new window.kakao.maps.LatLngBounds(
    new window.kakao.maps.LatLng(33.05, 124.55),
    new window.kakao.maps.LatLng(38.85, 131.85)
  );
  state.mainMap.setBounds(
    bounds,
    visibleMapTopInset() + 8,
    10,
    sheetHeight + 16,
    10
  );
}

function positionMainMapControls() {
  if (!els.realMap || !els.bottomSheet) return;
  const sheetHeight = `${Math.ceil(visibleBottomSheetHeight())}px`;
  els.mapStage.style.setProperty("--sheet-height", sheetHeight);
  els.userScreen?.style.setProperty("--sheet-height", sheetHeight);
}

function isBottomSheetVisible() {
  return Boolean(els.bottomSheet && !els.bottomSheet.classList.contains("is-hidden"));
}

function visibleBottomSheetHeight() {
  return isBottomSheetVisible() ? els.bottomSheet.getBoundingClientRect().height : 0;
}

function initializeRegistrationMap() {
  if (!window.kakao?.maps?.Map || !els.registrationMap) return;
  if (!state.registrationMapInstance) {
    state.registrationMapInstance = new window.kakao.maps.Map(els.registrationMap, {
      center: new window.kakao.maps.LatLng(36.25, 127.8),
      level: kakaoLevelFromZoom(6)
    });
    state.registrationMapInstance.setMinLevel(1);
    state.registrationMapInstance.setMaxLevel(13);
    window.kakao.maps.event.addListener(state.registrationMapInstance, "click", (event) => {
      setRegistrationLocation(event.latLng.getLat(), event.latLng.getLng(), els.registerAddress.value.trim(), "adjusted");
    });
  }
  window.setTimeout(() => {
    state.registrationMapInstance.relayout();
    if (state.registrationLocation) updateRegistrationMarker(true);
  }, 0);
}

async function loadKakaoServices() {
  if (state.kakaoGeocoder) return state.kakaoGeocoder;
  await loadKakaoMapSdk();
  if (!window.kakao?.maps?.services?.Geocoder) {
    throw new Error("Kakao Maps services library is unavailable");
  }
  state.kakaoGeocoder = new window.kakao.maps.services.Geocoder();
  return state.kakaoGeocoder;
}

async function geocodeAddress(address) {
  const query = String(address || "").trim();
  if (!query) throw new Error("주소를 입력해 주세요.");

  const verifiedLocation = findVerifiedAddressLocation(query);
  if (verifiedLocation) {
    return {
      latitude: verifiedLocation.latitude,
      longitude: verifiedLocation.longitude,
      address: verifiedLocation.address,
      source: "verified-building"
    };
  }

  const localMatch = findLocalAddressMatch(query);
  if (localMatch) {
    return {
      latitude: localMatch.latitude,
      longitude: localMatch.longitude,
      address: localMatch.address || query,
      source: "parking-data"
    };
  }

  try {
    if (!shouldUseKakaoServices()) throw new Error("Use local geocoder");
    const geocoder = state.kakaoGeocoder || await loadKakaoServices();
    const result = await new Promise((resolve, reject) => {
      geocoder.addressSearch(query, (documents, status) => {
        if (status === window.kakao.maps.services.Status.OK && documents[0]) resolve(documents[0]);
        else reject(new Error("주소 검색 결과가 없습니다."));
      });
    });
    return {
      latitude: Number(result.y),
      longitude: Number(result.x),
      address: result.road_address?.address_name || result.address_name || query,
      source: "kakao"
    };
  } catch {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "kr");
    url.searchParams.set("accept-language", "ko");
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("주소 검색 서버에 연결할 수 없습니다.");
    const results = await response.json();
    if (!results[0]) throw new Error("주소 위치를 찾지 못했습니다. 도로명과 건물번호를 확인해 주세요.");
    const candidate = results[0];
    const preciseTypes = new Set(["house", "building", "amenity", "office", "school", "commercial", "retail"]);
    const isBuildingResult = candidate.category === "building" || preciseTypes.has(candidate.addresstype);
    return {
      latitude: Number(candidate.lat),
      longitude: Number(candidate.lon),
      address: query,
      source: isBuildingResult ? "openstreetmap-building" : "openstreetmap-road"
    };
  }
}

function findVerifiedAddressLocation(query) {
  const normalized = normalizeAddress(query);
  return VERIFIED_ADDRESS_LOCATIONS.find((location) => (
    location.aliases.some((alias) => normalizeAddress(alias) === normalized)
  )) || null;
}

function shouldUseKakaoServices() {
  return Boolean(state.runtimeConfig?.kakaoConfigured && window.kakao?.maps?.services);
}

function findLocalAddressMatch(query) {
  const normalized = normalizeAddress(query);
  if (normalized.length < 6) return null;
  return state.lots.find((lot) => {
    const candidate = normalizeAddress(lot.address);
    return candidate === normalized || (
      Math.abs(candidate.length - normalized.length) <= 4 &&
      (candidate.includes(normalized) || normalized.includes(candidate))
    );
  }) || null;
}

function normalizeAddress(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/대한민국|특별시|광역시|특별자치시|특별자치도/g, "")
    .replace(/[^0-9a-z가-힣]/g, "");
}

async function resolveRegistrationAddress() {
  const address = els.registerAddress.value.trim();
  const token = ++state.registrationGeocodeToken;
  state.registrationLocation = null;
  els.registerLatitude.value = "";
  els.registerLongitude.value = "";
  setRegistrationLocationStatus("입력한 주소를 지도에서 찾고 있습니다.", "loading");
  try {
    const result = await geocodeAddress(address);
    if (token !== state.registrationGeocodeToken) return;
    setRegistrationLocation(result.latitude, result.longitude, result.address, result.source);
  } catch (error) {
    if (token !== state.registrationGeocodeToken) return;
    setRegistrationLocationStatus(error.message, "error");
  }
}

function setRegistrationLocation(latitude, longitude, address, source = "adjusted") {
  if (![latitude, longitude].every(Number.isFinite)) return;
  state.registrationLocation = { latitude, longitude, address, source };
  els.registerLatitude.value = String(latitude);
  els.registerLongitude.value = String(longitude);
  const status = registrationLocationStatus(address, source);
  setRegistrationLocationStatus(status.message, status.stateName);
  updateRegistrationMarker(true);
}

function registrationLocationStatus(address, source) {
  if (source === "adjusted") {
    return { message: `${address} · 핀 위치를 직접 지정했습니다.`, stateName: "success" };
  }
  if (source === "openstreetmap-road") {
    return {
      message: `${address} · 도로 중심을 찾았습니다. 지도를 눌러 건물 위치로 조정해 주세요.`,
      stateName: "warning"
    };
  }
  if (source === "parking-data") {
    return { message: `${address} · 기존 주차장 데이터 위치를 확인했습니다.`, stateName: "success" };
  }
  return { message: `${address} · 건물 위치를 확인했습니다.`, stateName: "success" };
}

function setRegistrationLocationStatus(message, stateName) {
  if (!els.registrationLocationLabel) return;
  els.registrationLocationLabel.textContent = message;
  els.registrationLocationLabel.className = `selected-location is-${stateName}`;
}

function updateRegistrationMarker(centerMap = false) {
  if (!state.registrationMapInstance || !state.registrationLocation) return;
  const latlng = new window.kakao.maps.LatLng(
    state.registrationLocation.latitude,
    state.registrationLocation.longitude
  );
  if (!state.registrationMarker) {
    state.registrationMarker = new window.kakao.maps.Marker({
      map: state.registrationMapInstance,
      position: latlng,
      draggable: true,
      clickable: true,
      title: "등록할 주차장 위치"
    });
    window.kakao.maps.event.addListener(state.registrationMarker, "dragend", () => {
      const point = state.registrationMarker.getPosition();
      setRegistrationLocation(point.getLat(), point.getLng(), els.registerAddress.value.trim(), "adjusted");
    });
  } else {
    state.registrationMarker.setPosition(latlng);
  }
  if (centerMap) {
    state.registrationMapInstance.jump(latlng, kakaoLevelFromZoom(18), { animate: true });
  }
}

function project(lat, lng) {
  const x = ((lng - KOREA_BOUNDS.minLng) / (KOREA_BOUNDS.maxLng - KOREA_BOUNDS.minLng)) * 1600;
  const y = (1 - ((lat - KOREA_BOUNDS.minLat) / (KOREA_BOUNDS.maxLat - KOREA_BOUNDS.minLat))) * 2200;
  return { x, y };
}

function centerMapOn(lat, lng, scale = state.transform.scale) {
  const { x, y } = project(lat, lng);
  const rect = els.mapStage.getBoundingClientRect();
  state.transform.scale = clamp(scale, FALLBACK_MAP_MIN_SCALE, 8);
  state.transform.x = rect.width / 2 - x * state.transform.scale;
  state.transform.y = rect.height * 0.38 - y * state.transform.scale;
  constrainTransform();
  applyTransform();
}

function focusMapOn(lat, lng, zoom = 15) {
  if (state.mapMode === "kakao" && state.mainMap) {
    const latlng = new window.kakao.maps.LatLng(lat, lng);
    state.mainMap.jump(
      latlng,
      kakaoLevelFromZoom(clamp(zoom, MAIN_MAP_MIN_ZOOM, MAIN_MAP_MAX_ZOOM)),
      { animate: true }
    );
    window.setTimeout(() => positionLocationInVisibleMap(lat, lng), 0);
    return;
  }
  const fallbackScale = zoom >= 15 ? 4.2 : zoom >= 10 ? 2.4 : 0.7;
  centerMapOn(lat, lng, fallbackScale);
}

function visibleMapCenterPoint() {
  const mapElement = state.mapMode === "kakao" ? els.realMap : els.mapStage;
  const mapRect = mapElement?.getBoundingClientRect();
  if (!mapRect) return { x: 195, y: 422 };
  const top = visibleMapTopInset();
  const bottom = clamp(visibleMapBottomOffset(mapRect), top + 80, mapRect.height);
  return { x: mapRect.width / 2, y: (top + bottom) / 2 };
}

function visibleMapBottomOffset(mapRect) {
  if (!isBottomSheetVisible()) return mapRect.height;
  const sheetRect = els.bottomSheet.getBoundingClientRect();
  return clamp(sheetRect.top - mapRect.top, 0, mapRect.height);
}

function visibleMapTopInset() {
  const mapRect = (els.realMap || els.mapStage)?.getBoundingClientRect();
  const controlsRect = els.topControls?.getBoundingClientRect();
  if (!mapRect || !controlsRect) return 68;
  return clamp(controlsRect.bottom - mapRect.top + 8, 68, mapRect.height * 0.46);
}

function positionLocationInVisibleMap(lat, lng) {
  if (state.mapMode !== "kakao" || !state.mainMap) return;
  const point = state.mainMap.getProjection().containerPointFromCoords(
    new window.kakao.maps.LatLng(lat, lng)
  );
  const visibleCenter = visibleMapCenterPoint();
  state.mainMap.panBy(point.x - visibleCenter.x, point.y - visibleCenter.y);
}

function renderMapMarkers() {
  if (state.mapMode === "kakao" && state.mainMap) {
    renderKakaoMarkers();
  } else {
    renderMarkers();
  }
}

function renderKakaoMarkers() {
  const map = state.mainMap;
  const zoom = mainMapZoom();
  const markerMode = zoom < MAP_MARKER_MIN_ZOOM
    ? "hidden"
    : zoom < MAP_MARKER_DETAIL_ZOOM ? "compact" : "detail";
  const source = state.mapSearchKeyword || hasActiveLotFilters() ? state.filteredLots : state.lots;
  const bounds = map.getBounds();
  const visibleLots = source.filter((lot) => bounds.contain(
    new window.kakao.maps.LatLng(lot.latitude, lot.longitude)
  ));

  clearMainMarkerOverlays();
  setMapZoomNotice(markerMode === "hidden");
  if (markerMode === "hidden") return;

  if (markerMode === "compact") {
    makeCompactKakaoGroups(visibleLots).forEach((group) => {
      const label = compactMarkerValue(group.lots);
      const markerKind = group.lots.length > 1 ? "is-group" : "is-single";
      const content = document.createElement("button");
      content.type = "button";
      content.className = `compact-parking-marker ${markerKind}`;
      content.innerHTML = `<b>${label}</b>`;
      content.setAttribute("aria-label", `${group.lots.length}개 주차장`);
      content.addEventListener("click", (event) => {
        event.stopPropagation();
        const target = group.lots.length === 1 ? group.lots[0] : group;
        if (group.lots.length === 1) state.selectedLot = group.lots[0];
        map.jump(
          new window.kakao.maps.LatLng(target.latitude, target.longitude),
          kakaoLevelFromZoom(MAP_MARKER_DETAIL_ZOOM),
          { animate: true }
        );
      });
      const overlay = new window.kakao.maps.CustomOverlay({
        map,
        position: new window.kakao.maps.LatLng(group.latitude, group.longitude),
        content,
        xAnchor: 0.5,
        yAnchor: 0.5,
        clickable: true,
        zIndex: 8
      });
      state.mainMarkerOverlays.push(overlay);
    });
    return;
  }

  visibleKakaoDetailLots(visibleLots).forEach((lot) => {
    const metrics = getMarkerCardMetrics(lot);
    const wrapper = document.createElement("div");
    wrapper.innerHTML = parkingMarkerMarkup(lot, metrics).trim();
    const content = wrapper.firstElementChild;
    content.setAttribute("role", "button");
    content.setAttribute("tabindex", "0");
    content.setAttribute("aria-label", `${lot.name}, ${availabilityLabel(lot)}`);
    const select = (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectLot(lot, true);
    };
    content.addEventListener("click", select);
    content.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") select(event);
    });
    const overlay = new window.kakao.maps.CustomOverlay({
      map,
      position: new window.kakao.maps.LatLng(lot.latitude, lot.longitude),
      content,
      xAnchor: 0.5,
      yAnchor: 1.08,
      clickable: true,
      zIndex: 9
    });
    state.mainMarkerOverlays.push(overlay);
  });
}

function clearMainMarkerOverlays() {
  state.mainMarkerOverlays.forEach((overlay) => overlay.setMap(null));
  state.mainMarkerOverlays = [];
}

function setMapZoomNotice(visible) {
  if (els.mapZoomNotice) els.mapZoomNotice.hidden = !visible;
}

function visibleKakaoDetailLots(lots) {
  const mapRect = els.realMap?.getBoundingClientRect();
  if (!mapRect) return lots;
  const visibleBottom = visibleMapBottomOffset(mapRect);
  const visibleTop = visibleMapTopInset();

  return lots.filter((lot) => {
    const point = state.mainMap.getProjection().containerPointFromCoords(
      new window.kakao.maps.LatLng(lot.latitude, lot.longitude)
    );
    const halfWidth = getMarkerCardMetrics(lot).width / 2 + 4;
    return point.x >= halfWidth &&
      point.x <= mapRect.width - halfWidth &&
      point.y >= visibleTop &&
      point.y <= visibleBottom - 8;
  });
}

function makeCompactKakaoGroups(lots) {
  const mapRect = els.realMap?.getBoundingClientRect();
  const visibleBottom = mapRect ? visibleMapBottomOffset(mapRect) : window.innerHeight;
  const visibleTop = visibleMapTopInset();
  const buckets = new Map();

  lots.forEach((lot) => {
    const point = state.mainMap.getProjection().containerPointFromCoords(
      new window.kakao.maps.LatLng(lot.latitude, lot.longitude)
    );
    if (point.x < 22 || point.x > (mapRect?.width || window.innerWidth) - 22 || point.y < visibleTop || point.y > visibleBottom - 22) return;
    const key = `${Math.floor(point.x / COMPACT_MARKER_CELL_SIZE)}:${Math.floor(point.y / COMPACT_MARKER_CELL_SIZE)}`;
    const group = buckets.get(key) || { lots: [], latitude: 0, longitude: 0 };
    group.lots.push(lot);
    group.latitude += lot.latitude;
    group.longitude += lot.longitude;
    buckets.set(key, group);
  });

  return [...buckets.values()].map((group) => ({
    ...group,
    latitude: group.latitude / group.lots.length,
    longitude: group.longitude / group.lots.length
  }));
}

function compactMarkerValue(lots) {
  if (lots.length === 1) return "P";
  return lots.length > 99 ? "99+" : String(lots.length);
}

function parkingMarkerMarkup(lot, metrics = getMarkerCardMetrics(lot)) {
  return `
    <span class="parking-marker map-overlay${lot.isOpen ? "" : " closed"}" style="--marker-width:${metrics.width}px">
      <span class="top">
        <span class="count">${availabilityLabel(lot)}</span>
        <span class="badge">${lot.isOpen ? "운영" : "마감"}</span>
      </span>
      <span class="price">${priceLabel(lot, true)}</span>
    </span>
  `;
}

function getMarkerCardMetrics(lot) {
  const countText = availabilityLabel(lot);
  const priceText = priceLabel(lot, true);
  const countRowWidth = countText.length * 5.5 + 49;
  const priceRowWidth = priceText.length * 9.2 + 16;
  return {
    width: Math.ceil(clamp(Math.max(68, countRowWidth, priceRowWidth), 68, 112)),
    height: 48
  };
}

function normalizeSearchText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "").replace(/[^0-9a-z가-힣]/g, "");
}

function localSearchSuggestions(query) {
  const keyword = normalizeSearchText(query);
  if (!keyword) return [];
  return state.lots
    .map((lot) => {
      const name = normalizeSearchText(lot.name);
      const address = normalizeSearchText(lot.address);
      let score = 99;
      if (name === keyword) score = 0;
      else if (name.startsWith(keyword)) score = 1;
      else if (name.includes(keyword)) score = 2;
      else if (address.includes(keyword)) score = 3;
      return { lot, score };
    })
    .filter(({ score }) => score < 99)
    .sort((a, b) => a.score - b.score || a.lot.name.localeCompare(b.lot.name, "ko"))
    .slice(0, 4)
    .map(({ lot }) => ({
      id: `lot:${lot.id}`,
      name: lot.name,
      address: lot.address,
      category: `${lot.parkingType} 주차장`,
      latitude: lot.latitude,
      longitude: lot.longitude,
      source: "parkview",
      lot
    }));
}

async function kakaoKeywordSuggestions(query) {
  if (!shouldUseKakaoServices()) return [];
  await loadKakaoMapSdk();
  if (!window.kakao?.maps?.services?.Places) return [];
  const places = state.kakaoPlaces || new window.kakao.maps.services.Places(state.mainMap || undefined);
  state.kakaoPlaces = places;
  const options = { size: 10 };
  if (state.userLocation) {
    options.location = new window.kakao.maps.LatLng(
      state.userLocation.latitude,
      state.userLocation.longitude
    );
    options.sort = window.kakao.maps.services.SortBy.DISTANCE;
  }
  const results = await new Promise((resolve, reject) => {
    places.keywordSearch(query, (documents, status) => {
      if (status === window.kakao.maps.services.Status.OK) resolve(documents);
      else if (status === window.kakao.maps.services.Status.ZERO_RESULT) resolve([]);
      else reject(new Error(`Kakao place search failed: ${status}`));
    }, options);
  });
  return results.map((place) => ({
    id: `place:${place.id}`,
    name: place.place_name,
    address: place.road_address_name || place.address_name,
    category: place.category_group_name || String(place.category_name || "장소").split(" > ").pop(),
    latitude: Number(place.y),
    longitude: Number(place.x),
    distanceMeters: optionalNumber(place.distance),
    source: "kakao-place",
    placeUrl: place.place_url
  })).filter((place) => Number.isFinite(place.latitude) && Number.isFinite(place.longitude));
}

function mergeSearchSuggestions(local, remote) {
  const merged = [...local];
  remote.forEach((candidate) => {
    const duplicate = merged.some((existing) => {
      const sameName = normalizeSearchText(existing.name) === normalizeSearchText(candidate.name);
      const distance = haversineKm(
        existing.latitude,
        existing.longitude,
        candidate.latitude,
        candidate.longitude
      ) * 1000;
      return sameName && distance < 50;
    });
    if (!duplicate) merged.push(candidate);
  });
  return merged.slice(0, 10);
}

function handleSearchInput() {
  const query = els.searchInput.value.trim();
  window.clearTimeout(state.searchSuggestionTimer);
  state.searchSuggestionToken += 1;
  state.searchSuggestionIndex = -1;
  if (!query) {
    resetMapSearch();
    return;
  }

  const local = localSearchSuggestions(query);
  state.searchSuggestions = local;
  renderSearchSuggestions();
  if (query.length < 2) return;

  const token = state.searchSuggestionToken;
  state.searchSuggestionTimer = window.setTimeout(async () => {
    try {
      const remote = await kakaoKeywordSuggestions(query);
      if (token !== state.searchSuggestionToken || query !== els.searchInput.value.trim()) return;
      state.searchSuggestions = mergeSearchSuggestions(local, remote);
      renderSearchSuggestions();
      if (!state.searchSuggestions.length) setSearchFeedback("검색 결과가 없습니다.", true);
    } catch (error) {
      console.warn("[ParkView] place suggestions unavailable", error);
      if (!local.length) setSearchFeedback("장소 검색에 연결하지 못했습니다.", true);
    }
  }, 240);
}

function renderSearchSuggestions() {
  els.searchSuggestions.replaceChildren();
  if (!state.searchSuggestions.length || !els.searchInput.value.trim()) {
    hideSearchSuggestions();
    return;
  }
  const fragment = document.createDocumentFragment();
  state.searchSuggestions.forEach((suggestion, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-suggestion";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(index === state.searchSuggestionIndex));
    button.innerHTML = `
      <i data-lucide="map-pin" aria-hidden="true"></i>
      <span><strong>${escapeHtml(suggestion.name)}</strong><small>${escapeHtml(suggestion.address || suggestion.category)}</small></span>
      <em>${escapeHtml(suggestion.category)}</em>
    `;
    button.addEventListener("click", () => selectSearchSuggestion(suggestion));
    fragment.appendChild(button);
  });
  els.searchSuggestions.appendChild(fragment);
  els.searchSuggestions.hidden = false;
  els.searchPanel.classList.add("has-suggestions");
  els.searchInput.setAttribute("aria-expanded", "true");
  refreshIcons();
}

function hideSearchSuggestions() {
  els.searchSuggestions.hidden = true;
  els.searchPanel.classList.remove("has-suggestions");
  els.searchInput.setAttribute("aria-expanded", "false");
  state.searchSuggestionIndex = -1;
}

function setSearchSuggestionIndex(index) {
  const count = state.searchSuggestions.length;
  if (!count) return;
  state.searchSuggestionIndex = (index + count) % count;
  [...els.searchSuggestions.querySelectorAll(".search-suggestion")].forEach((button, buttonIndex) => {
    const selected = buttonIndex === state.searchSuggestionIndex;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", String(selected));
    if (selected) button.scrollIntoView({ block: "nearest" });
  });
}

function onSearchInputKeyDown(event) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (!state.searchSuggestions.length) return;
    event.preventDefault();
    setSearchSuggestionIndex(state.searchSuggestionIndex + (event.key === "ArrowDown" ? 1 : -1));
    return;
  }
  if (event.key === "Escape") {
    hideSearchSuggestions();
    return;
  }
  if (event.key !== "Enter") return;
  event.preventDefault();
  const suggestion = state.searchSuggestions[state.searchSuggestionIndex] || state.searchSuggestions[0];
  if (suggestion) selectSearchSuggestion(suggestion);
  else searchMapLocation();
}

function updateSearchLocationMarker(suggestion) {
  if (state.mapMode !== "kakao" || !state.mainMap || !window.kakao?.maps) return;
  const position = new window.kakao.maps.LatLng(suggestion.latitude, suggestion.longitude);
  if (state.searchLocationMarker) {
    state.searchLocationMarker.setPosition(position);
    return;
  }
  const content = document.createElement("span");
  content.className = "search-location-pin";
  content.innerHTML = '<i data-lucide="map-pin" aria-hidden="true"></i>';
  state.searchLocationMarker = new window.kakao.maps.CustomOverlay({
    map: state.mainMap,
    position,
    content,
    xAnchor: 0.5,
    yAnchor: 1,
    zIndex: 21
  });
  refreshIcons();
}

function clearSearchLocationMarker() {
  state.searchLocationMarker?.setMap?.(null);
  state.searchLocationMarker = null;
}

function selectSearchSuggestion(suggestion) {
  window.clearTimeout(state.searchSuggestionTimer);
  state.searchSuggestionToken += 1;
  els.searchInput.value = suggestion.name;
  hideSearchSuggestions();
  state.mapSearchKeyword = "";
  state.filteredLots = filterLotCollection(state.lots, "");
  if (suggestion.lot) state.selectedLot = suggestion.lot;
  showListView();
  updateSearchLocationMarker(suggestion);
  focusMapOn(suggestion.latitude, suggestion.longitude, 16);
  renderMapMarkers();
  renderList();
  window.setTimeout(refreshNearbyList, 320);
  setSearchFeedback(`${suggestion.name} 주변 주차장을 표시합니다.`);
}

async function searchMapLocation() {
  const query = els.searchInput.value.trim();
  if (!query) {
    resetMapSearch();
    return;
  }
  setSearchFeedback("장소를 검색하고 있습니다.", false, 6000);
  try {
    const local = localSearchSuggestions(query);
    let remote = [];
    try {
      remote = await kakaoKeywordSuggestions(query);
    } catch (error) {
      console.warn("[ParkView] keyword search unavailable; trying address search", error);
    }
    const suggestion = mergeSearchSuggestions(local, remote)[0];
    if (suggestion) {
      selectSearchSuggestion(suggestion);
      return;
    }
    const location = await geocodeAddress(query);
    selectSearchSuggestion({
      id: `address:${location.latitude}:${location.longitude}`,
      name: location.address || query,
      address: location.address || query,
      category: "주소",
      latitude: location.latitude,
      longitude: location.longitude,
      source: location.source
    });
  } catch {
    setSearchFeedback("장소나 주소를 찾지 못했습니다.", true);
  }
}

function resetMapSearch() {
  window.clearTimeout(state.searchSuggestionTimer);
  state.searchSuggestionToken += 1;
  state.searchSuggestions = [];
  hideSearchSuggestions();
  clearSearchLocationMarker();
  els.searchInput.value = "";
  state.mapSearchKeyword = "";
  state.filteredLots = filterLotCollection(state.lots, "");
  updateSheetTitle();
  renderMapMarkers();
  if (state.mapMode === "kakao" && state.mainMap) refreshNearbyList();
  else renderList();
}

function refreshNearbyList() {
  if (state.mapSearchKeyword || state.mapMode !== "kakao" || !state.mainMap) return;
  const visibleCenter = visibleMapCenterPoint();
  const center = state.mainMap.getProjection().coordsFromContainerPoint(
    new window.kakao.maps.Point(visibleCenter.x, visibleCenter.y)
  );
  const centerLat = center.getLat();
  const centerLng = center.getLng();
  state.filteredLots = filterLotCollection(state.lots, "")
    .sort((a, b) => (
      haversineKm(centerLat, centerLng, a.latitude, a.longitude) -
      haversineKm(centerLat, centerLng, b.latitude, b.longitude)
    ))
    .slice(0, 700);
  if (hasActiveLotFilters()) renderMapMarkers();
  renderList();
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRadians = (value) => value * Math.PI / 180;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLng = toRadians(lng2 - lng1);
  const a = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function applyTransform() {
  els.mapWorld.style.transform = `translate3d(${state.transform.x}px, ${state.transform.y}px, 0) scale(${state.transform.scale})`;
}

function constrainTransform() {
  const rect = els.mapStage.getBoundingClientRect();
  const width = 1600 * state.transform.scale;
  const height = 2200 * state.transform.scale;
  state.transform.x = clamp(state.transform.x, rect.width - width - 80, 80);
  state.transform.y = clamp(state.transform.y, rect.height - height - 120, 120);
}

function renderMarkers() {
  const lots = state.filteredLots;
  const scale = state.transform.scale;
  const markerMode = scale < 2.5 ? "hidden" : scale < 4.2 ? "compact" : "detail";
  const fragment = document.createDocumentFragment();
  els.markerLayer.replaceChildren();
  setMapZoomNotice(markerMode === "hidden");
  if (markerMode === "hidden") return;

  const visibleLots = visibleFallbackLots(lots);
  if (markerMode === "compact") {
    makeCompactFallbackGroups(visibleLots).forEach((group) => {
      const point = project(group.latitude, group.longitude);
      const marker = document.createElement("button");
      marker.className = `compact-parking-marker fallback-compact-marker ${group.lots.length > 1 ? "is-group" : "is-single"}`;
      marker.style.setProperty("--marker-scale", String(1 / scale));
      marker.style.left = `${point.x}px`;
      marker.style.top = `${point.y}px`;
      marker.textContent = compactMarkerValue(group.lots);
      marker.setAttribute("aria-label", `${group.lots.length}개 주차장`);
      marker.addEventListener("click", (event) => {
        event.stopPropagation();
        const target = group.lots.length === 1 ? group.lots[0] : group;
        if (group.lots.length === 1) state.selectedLot = group.lots[0];
        centerMapOn(target.latitude, target.longitude, Math.max(4.2, scale * 1.8));
        renderMarkers();
      });
      fragment.appendChild(marker);
    });
  } else {
    visibleLots.forEach((lot) => {
      const { x, y } = project(lot.latitude, lot.longitude);
      const marker = document.createElement("button");
      marker.className = `parking-marker${lot.isOpen ? "" : " closed"}`;
      marker.style.setProperty("--marker-scale", String(1 / scale));
      marker.style.setProperty("--marker-width", `${getMarkerCardMetrics(lot).width}px`);
      marker.style.left = `${x}px`;
      marker.style.top = `${y}px`;
      marker.innerHTML = `
        <span class="top">
          <span class="count">${availabilityLabel(lot)}</span>
          <span class="badge">${lot.isOpen ? "운영" : "마감"}</span>
        </span>
        <span class="price">${priceLabel(lot, true)}</span>
      `;
      marker.addEventListener("click", (event) => {
        event.stopPropagation();
        selectLot(lot, true);
      });
      fragment.appendChild(marker);
    });
  }

  els.markerLayer.appendChild(fragment);
}

function visibleFallbackLots(lots) {
  const mapRect = els.mapStage?.getBoundingClientRect();
  const width = mapRect?.width || window.innerWidth;
  const visibleBottom = mapRect ? visibleMapBottomOffset(mapRect) : window.innerHeight;
  const visibleTop = visibleMapTopInset();
  return lots.filter((lot) => {
    const point = project(lot.latitude, lot.longitude);
    const screenX = point.x * state.transform.scale + state.transform.x;
    const screenY = point.y * state.transform.scale + state.transform.y;
    return screenX >= 24 && screenX <= width - 24 && screenY >= visibleTop && screenY <= visibleBottom - 24;
  });
}

function makeCompactFallbackGroups(lots) {
  const buckets = new Map();
  lots.forEach((lot) => {
    const point = project(lot.latitude, lot.longitude);
    const screenX = point.x * state.transform.scale + state.transform.x;
    const screenY = point.y * state.transform.scale + state.transform.y;
    const key = `${Math.floor(screenX / COMPACT_MARKER_CELL_SIZE)}:${Math.floor(screenY / COMPACT_MARKER_CELL_SIZE)}`;
    const group = buckets.get(key) || { lots: [], latitude: 0, longitude: 0 };
    group.lots.push(lot);
    group.latitude += lot.latitude;
    group.longitude += lot.longitude;
    buckets.set(key, group);
  });

  return [...buckets.values()].map((group) => ({
    ...group,
    latitude: group.latitude / group.lots.length,
    longitude: group.longitude / group.lots.length
  }));
}

function renderList() {
  const sheetHeight = els.bottomSheet?.getBoundingClientRect().height || window.innerHeight * 0.56;
  const visibleCount = Math.round(clamp(Math.ceil((sheetHeight - 70) / 92) + 2, 5, 30));
  const list = state.filteredLots.slice(0, visibleCount);
  if (list.length) {
    els.lotList.replaceChildren(...list.map((lot) => lotCard(lot)));
    return;
  }
  const empty = document.createElement("p");
  empty.className = "lot-list-empty";
  empty.textContent = state.filters.favoritesOnly
    ? "즐겨찾는 주차장이 없습니다."
    : "조건에 맞는 주차장이 없습니다.";
  els.lotList.replaceChildren(empty);
}

function lotCard(lot) {
  const button = document.createElement("button");
  button.className = "lot-card";
  button.innerHTML = `
    <span class="lot-main">
      <h2>${escapeHtml(lot.name)}</h2>
      <p>${formatLotDistance(lot)}</p>
      <span class="open-dot">${lot.isOpen ? "운영중" : "운영종료"}</span>
    </span>
    <span class="lot-side">
      <span><span class="lot-status${lot.isOpen ? "" : " closed"}">${lot.isOpen ? "운영" : "마감"}</span> ${availabilityLabel(lot)}</span>
      <span>${priceLabel(lot)}</span>
    </span>
  `;
  button.addEventListener("click", () => selectLot(lot, true));
  return button;
}

function selectLot(lot, openDetail = false) {
  state.selectedLot = lot;
  state.floors = lot.floors;
  state.floorIndex = 0;
  if (openDetail) showDetail(lot);
  focusMapOn(lot.latitude, lot.longitude, Math.max(15, state.mainMap ? mainMapZoom() : 15));
  renderMapMarkers();
}

function showDetail(lot) {
  showBottomSheet();
  els.listView.classList.remove("active");
  els.detailView.classList.add("active");
  els.bottomSheet.classList.add("detail-mode");
  els.sheetHandle.setAttribute("aria-expanded", "true");
  state.floorIndex = 0;
  renderLotDetail(lot);
  const bounds = bottomSheetBounds();
  const currentHeight = els.bottomSheet.getBoundingClientRect().height;
  applyBottomSheetHeight(Math.max(currentHeight, bounds.medium), true);
}

function showListView() {
  els.detailView.classList.remove("active");
  els.listView.classList.add("active");
  els.bottomSheet.classList.remove("detail-mode");
  renderList();
}

function showBottomSheet() {
  if (!els.bottomSheet) return;
  els.bottomSheet.classList.remove("is-hidden");
  els.bottomSheet.setAttribute("aria-hidden", "false");
  positionMainMapControls();
  window.setTimeout(() => {
    positionMainMapControls();
    renderMapMarkers();
  }, 270);
}

function hideBottomSheet() {
  if (!isBottomSheetVisible()) return;
  els.bottomSheet.classList.add("is-hidden");
  els.bottomSheet.setAttribute("aria-hidden", "true");
  positionMainMapControls();
  renderMapMarkers();
}

function renderLotDetail(lot) {
  const isFavorite = state.favoriteLotIds.has(String(lot.id));
  const feeLabel = priceLabel(lot);
  const hasRealtime = hasLiveAvailability(lot);
  const hasTotalSpaces = Number.isFinite(lot.totalSpaces);
  const operatingHours = `${lot.weekdayStart} ~ ${lot.weekdayEnd}`;
  const floor = lot.floors[state.floorIndex];
  const floorPlanMarkup = floor ? `
    <p class="detail-section-label">층별 위치 안내</p>
    <div class="floor-head">
      <button class="floor-nav" id="detailPrev" aria-label="이전 층" ${state.floorIndex === 0 ? "disabled" : ""}>‹</button>
      <strong>${escapeHtml(floor.name)}</strong>
      <button class="floor-nav" id="detailNext" aria-label="다음 층" ${state.floorIndex === lot.floors.length - 1 ? "disabled" : ""}>›</button>
    </div>
    <div id="detailFloorPlan" class="floor-plan blueprint-plan"></div>
  ` : "";
  els.lotDetail.innerHTML = `
    <header class="detail-hero">
      <div class="detail-heading-row">
        <span class="detail-type">${escapeHtml(lot.parkingType)}</span>
        <span class="detail-heading-copy">
          <h2 class="detail-title">${escapeHtml(lot.name)}</h2>
          <span class="detail-sub">${formatLotDistance(lot)} · ${lot.isOpen ? "운영 중" : "운영 종료"}</span>
        </span>
      </div>
      <div class="detail-actions" aria-label="주차장 작업">
        <button id="detailShare" class="detail-action" type="button"><i aria-hidden="true">↗</i><span>공유</span></button>
        <button id="detailFavorite" class="detail-action${isFavorite ? " is-active" : ""}" type="button"><i aria-hidden="true">${isFavorite ? "★" : "☆"}</i><span>즐겨찾기</span></button>
        <button id="detailNavigate" class="detail-action primary" type="button"><i aria-hidden="true">→</i><span>길찾기</span></button>
      </div>
      <p id="detailFeedback" class="detail-feedback" role="status"></p>
    </header>

    <section class="parking-info-panel" aria-label="주차장 이용 정보">
      <div class="parking-info-row"><span>주차요금</span><strong>${escapeHtml(feeLabel)}</strong></div>
      <div class="parking-info-row"><span>운영시간</span><strong>${escapeHtml(operatingHours)}</strong></div>
      ${hasRealtime ? '<button id="detailVacancyButton" class="detail-vacancy-button" type="button">실시간 빈자리 확인</button>' : ""}
    </section>

    <section class="detail-contact-list" aria-label="주차장 연락처와 주소">
      <div class="detail-contact-row"><i aria-hidden="true">⌖</i><span>${escapeHtml(lot.address || "주소 정보 없음")}</span></div>
      <div class="detail-contact-row"><i aria-hidden="true">☎</i>${lot.phone
        ? `<a href="tel:${escapeHtml(lot.phone.replace(/[^0-9+]/g, ""))}">${escapeHtml(lot.phone)}</a>`
        : "<span class=\"muted-contact\">전화번호 정보 없음</span>"}</div>
    </section>

    <section id="detailVacancySection" class="detail-content-section">
      <p class="detail-section-label">실시간 주차 현황</p>
      <div class="vacancy-card">
        <span>${hasRealtime
          ? "현재 이용 가능한 자리 <em>LIVE</em>"
          : hasTotalSpaces ? "전체 주차면 · 실시간 잔여 미제공" : "주차면 정보"}</span>
        <strong>${hasRealtime
          ? `${lot.availableSpaces}<small> / ${lot.totalSpaces}면</small>`
          : hasTotalSpaces ? `총 ${lot.totalSpaces}<small>면</small>` : "면수 정보 없음"}</strong>
      </div>
    </section>
    ${floorPlanMarkup}
  `;
  els.lotDetail.querySelector("#detailShare").addEventListener("click", () => shareLot(lot));
  els.lotDetail.querySelector("#detailFavorite").addEventListener("click", () => toggleFavoriteLot(lot));
  els.lotDetail.querySelector("#detailNavigate").addEventListener("click", () => navigateToLot(lot));
  els.lotDetail.querySelector("#detailVacancyButton")?.addEventListener("click", () => {
    expandBottomSheetToFull();
    window.setTimeout(() => {
      els.lotDetail.querySelector("#detailVacancySection")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 260);
  });
  els.lotDetail.querySelector("#detailPrev")?.addEventListener("click", () => {
    state.floorIndex = Math.max(0, state.floorIndex - 1);
    renderLotDetail(lot);
  });
  els.lotDetail.querySelector("#detailNext")?.addEventListener("click", () => {
    state.floorIndex = Math.min(lot.floors.length - 1, state.floorIndex + 1);
    renderLotDetail(lot);
  });
  if (floor) renderFloorPlan(els.lotDetail.querySelector("#detailFloorPlan"), floor, false);
}

function formatWon(value) {
  return `${Math.max(0, Number(value) || 0).toLocaleString("ko-KR")}원`;
}

function formatDistance(value) {
  const number = optionalNumber(value);
  if (number === null) return "거리 정보 없음";
  const meters = Math.max(0, number);
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)}km`;
}

function formatLotDistance(lot) {
  if (!state.userLocation) return "거리 정보 없음";
  const distanceMeters = haversineKm(
    state.userLocation.latitude,
    state.userLocation.longitude,
    lot.latitude,
    lot.longitude
  ) * 1000;
  return formatDistance(distanceMeters);
}

async function shareLot(lot) {
  const shareData = {
    title: lot.name,
    text: `${lot.name}\n${lot.address}\n${availabilityLabel(lot)}`,
    url: window.location.href
  };
  try {
    if (navigator.share) {
      await navigator.share(shareData);
    } else {
      await navigator.clipboard.writeText(`${shareData.text}\n${shareData.url}`);
      setDetailFeedback("주차장 정보가 복사되었습니다.");
    }
  } catch (error) {
    if (error?.name !== "AbortError") setDetailFeedback("공유 기능을 사용할 수 없습니다.", true);
  }
}

function toggleFavoriteLot(lot) {
  const id = String(lot.id);
  if (state.favoriteLotIds.has(id)) state.favoriteLotIds.delete(id);
  else state.favoriteLotIds.add(id);
  saveFavoriteLotIds();
  const button = els.lotDetail.querySelector("#detailFavorite");
  const active = state.favoriteLotIds.has(id);
  button?.classList.toggle("is-active", active);
  const icon = button?.querySelector("i");
  if (icon) icon.textContent = active ? "★" : "☆";
  updateMenuFavoriteCount();
  if (state.filters.favoritesOnly && !active) applyCurrentFilters();
  setDetailFeedback(active ? "즐겨찾기에 추가했습니다." : "즐겨찾기에서 삭제했습니다.");
}

function navigateToLot(lot) {
  const destination = `${encodeURIComponent(lot.name)},${lot.latitude},${lot.longitude}`;
  const destinationUrl = `https://map.kakao.com/link/to/${destination}`;

  if (!navigator.geolocation) {
    setDetailFeedback("이 기기에서는 현재 위치를 확인할 수 없어 목적지만 열었습니다.", true);
    window.open(destinationUrl, "_blank", "noopener");
    return;
  }

  setDetailFeedback("현재 위치를 확인하고 있습니다.");
  const routeTab = window.open("about:blank", "_blank");
  if (routeTab) {
    routeTab.opener = null;
    routeTab.document.title = "카카오맵 길찾기";
    routeTab.document.body.textContent = "현재 위치를 확인하고 있습니다.";
  }

  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const start = `${encodeURIComponent("현재 위치")},${coords.latitude},${coords.longitude}`;
      const routeUrl = `https://map.kakao.com/link/from/${start}/to/${destination}`;
      openNavigationUrl(routeTab, routeUrl);
      setDetailFeedback("현재 위치를 출발지로 설정했습니다.");
    },
    () => {
      openNavigationUrl(routeTab, destinationUrl);
      setDetailFeedback("위치 권한을 허용하지 않아 목적지만 열었습니다.", true);
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
  );
}

function openNavigationUrl(routeTab, url) {
  if (routeTab && !routeTab.closed) {
    routeTab.location.replace(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}

function setDetailFeedback(message, isError = false) {
  const feedback = els.lotDetail.querySelector("#detailFeedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("is-error", isError);
}

function makeFloors(seed = 1) {
  void seed;
  return [{ name: "B1", slots: [] }];
}

function makeSlots(seed = 1, highlightAvailable = false) {
  void seed;
  void highlightAvailable;
  return [];
}

function renderFloorPlan(container, floorOrSlots, editable) {
  if (!container) return;
  const floor = Array.isArray(floorOrSlots)
    ? { slots: floorOrSlots, elements: [], outline: [], zones: [] }
    : floorOrSlots || { slots: [], elements: [], outline: [], zones: [] };
  const slots = Array.isArray(floor.slots) ? floor.slots : [];
  const elements = Array.isArray(floor.elements) ? floor.elements : [];
  const zones = Array.isArray(floor.zones) ? floor.zones : [];
  const outline = resolveFloorOutline(floor, slots, elements);
  const hasPlan = slots.length > 0 || elements.length > 0 || zones.length > 0;

  container.replaceChildren();
  container.classList.toggle("has-plan", hasPlan);
  if (!hasPlan) return;

  const svgId = `floor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const svg = createSvgElement("svg", {
    class: "floor-plan-svg",
    viewBox: "0 0 160 100",
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
    "aria-label": `${floor.name || "주차장"} 건축 평면도`
  });
  const defs = createSvgElement("defs");
  const gridPattern = createSvgElement("pattern", {
    id: `${svgId}-grid`, width: 4, height: 4, patternUnits: "userSpaceOnUse"
  });
  gridPattern.appendChild(createSvgElement("path", {
    d: "M 4 0 L 0 0 0 4", class: "floor-grid-line"
  }));
  const stripePattern = createSvgElement("pattern", {
    id: `${svgId}-stripe`, width: 5, height: 5, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)"
  });
  stripePattern.appendChild(createSvgElement("rect", { width: 2.2, height: 5, class: "floor-stripe-fill" }));
  defs.append(gridPattern, stripePattern);
  svg.appendChild(defs);
  svg.appendChild(createSvgElement("rect", {
    x: 0, y: 0, width: 160, height: 100, fill: `url(#${svgId}-grid)`, class: "floor-canvas"
  }));

  const footprint = createSvgElement("polygon", {
    points: svgPoints(outline),
    class: "floor-footprint"
  });
  svg.appendChild(footprint);

  zones.forEach((zone) => {
    const polygon = createSvgElement("polygon", {
      points: svgPoints(zone.points),
      class: `floor-zone floor-zone-${zone.type}`
    });
    svg.appendChild(polygon);
    if (zone.label && zone.type !== "parking") {
      const center = polygonCenter(zone.points);
      svg.appendChild(createSvgElement("text", {
        x: toSvgX(center.x), y: center.y, class: "floor-zone-label room-label"
      }, zone.label));
    }
  });

  const backgroundTypes = new Set(["lane", "room", "stair", "elevator", "stripe"]);
  const drawableElements = elements.filter((element) => element.type !== "boundary");
  drawableElements.filter((element) => backgroundTypes.has(element.type)).forEach((element) => {
    renderSvgPlanElement(svg, element, `${svgId}-stripe`);
  });

  slots.forEach((slot, index) => {
    const sourcePolygon = getSourceSlotPolygon(slot);
    const orientation = sourcePolygon ? "source-polygon" : slot.w >= slot.h ? "horizontal" : "vertical";
    const group = createSvgElement("g", {
      class: `floor-slot floor-slot-${slot.kind} floor-slot-${slot.status} ${orientation}`,
      role: editable ? "button" : "img",
      tabindex: editable ? "0" : "-1",
      "aria-label": `${index + 1}번 주차면 ${slot.status === "available" ? "주차 가능" : "주차 중"}`
    });
    const symbol = slot.kind === "disabled" ? "♿" : slot.kind === "pregnant" ? "♀" : "";
    if (sourcePolygon) {
      group.appendChild(createSvgElement("polygon", {
        points: svgPoints(sourcePolygon),
        class: "floor-slot-body"
      }));
      const center = polygonCenter(sourcePolygon);
      if (symbol) {
        group.appendChild(createSvgElement("text", {
          x: toSvgX(center.x),
          y: center.y,
          class: "floor-slot-symbol"
        }, symbol));
      }
    } else {
      const x = toSvgX(slot.x);
      const y = slot.y;
      const width = toSvgX(slot.w);
      const height = slot.h;
      const rotation = clamp(Number(slot.rotation) || 0, -180, 180);
      if (Math.abs(rotation) > 0.1) {
        group.setAttribute("transform", `rotate(${rotation} ${x + width / 2} ${y + height / 2})`);
      }
      group.appendChild(createSvgElement("rect", { x, y, width, height, rx: 0.45, class: "floor-slot-body" }));
      group.appendChild(createSvgElement("rect", {
        x: x + 0.8,
        y: y + 0.8,
        width: Math.max(0.5, width - 1.6),
        height: Math.max(0.5, height - 1.6),
        rx: 0.25,
        class: "floor-slot-inset"
      }));
      if (orientation === "vertical") {
        group.appendChild(createSvgElement("line", {
          x1: x + width * 0.18, x2: x + width * 0.82,
          y1: y + height * 0.86, y2: y + height * 0.86,
          class: "floor-wheel-stop"
        }));
      } else {
        group.appendChild(createSvgElement("line", {
          x1: x + width * 0.86, x2: x + width * 0.86,
          y1: y + height * 0.18, y2: y + height * 0.82,
          class: "floor-wheel-stop"
        }));
      }
      if (symbol) {
        group.appendChild(createSvgElement("text", {
          x: x + width / 2,
          y: y + height / 2,
          class: "floor-slot-symbol"
        }, symbol));
      } else if (slot.status === "occupied") {
        if (orientation === "vertical") {
          group.appendChild(createSvgElement("rect", {
            x: x + width * 0.25,
            y: y + height * 0.16,
            width: width * 0.5,
            height: height * 0.58,
            rx: Math.min(width, height) * 0.16,
            class: "floor-vehicle-mark"
          }));
        } else {
          group.appendChild(createSvgElement("rect", {
            x: x + width * 0.16,
            y: y + height * 0.25,
            width: width * 0.58,
            height: height * 0.5,
            rx: Math.min(width, height) * 0.16,
            class: "floor-vehicle-mark"
          }));
        }
      }
    }
    if (editable) {
      const toggle = () => {
        slot.status = slot.status === "available" ? "occupied" : "available";
        syncSelectedLotFromAdmin();
        if (state.adminView === "management") renderManagement();
        else renderAdminFloor();
        renderList();
        renderMapMarkers();
      };
      group.addEventListener("click", toggle);
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
        }
      });
    }
    svg.appendChild(group);
  });
  drawableElements.filter((element) => !backgroundTypes.has(element.type)).forEach((element) => {
    renderSvgPlanElement(svg, element, `${svgId}-stripe`);
  });
  svg.appendChild(createSvgElement("polygon", {
    points: svgPoints(outline),
    class: "floor-outline-stroke"
  }));
  container.appendChild(svg);
}

function createSvgElement(name, attributes = {}, text = "") {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  if (text) element.textContent = text;
  return element;
}

function toSvgX(value) {
  return Number(value) * 1.6;
}

function svgPoints(points) {
  return points.map((point) => `${toSvgX(point.x)},${point.y}`).join(" ");
}

function getSourceSlotPolygon(slot) {
  const points = normalizeFloorPoints(slot?.sourcePolygon, 4);
  return points.length === 4 ? points.slice(0, 4) : null;
}

function polygonCenter(points) {
  const safe = points.length ? points : [{ x: 50, y: 50 }];
  return {
    x: safe.reduce((sum, point) => sum + point.x, 0) / safe.length,
    y: safe.reduce((sum, point) => sum + point.y, 0) / safe.length
  };
}

function resolveFloorOutline(floor, slots, elements) {
  const provided = normalizeFloorPoints(floor.outline, 3);
  if (provided.length >= 3) return provided;
  const boundary = elements.find((element) => element.type === "boundary");
  if (boundary) {
    return [
      { x: boundary.x, y: boundary.y },
      { x: boundary.x + boundary.w, y: boundary.y },
      { x: boundary.x + boundary.w, y: boundary.y + boundary.h },
      { x: boundary.x, y: boundary.y + boundary.h }
    ];
  }
  const items = [...slots, ...elements].filter((item) => [item.x, item.y, item.w, item.h].every(Number.isFinite));
  if (!items.length) return [{ x: 3, y: 4 }, { x: 97, y: 4 }, { x: 97, y: 96 }, { x: 3, y: 96 }];
  const minX = clamp(Math.min(...items.map((item) => item.x)) - 3, 2, 94);
  const minY = clamp(Math.min(...items.map((item) => item.y)) - 4, 2, 94);
  const maxX = clamp(Math.max(...items.map((item) => item.x + item.w)) + 3, 6, 98);
  const maxY = clamp(Math.max(...items.map((item) => item.y + item.h)) + 4, 6, 98);
  return [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }];
}

function renderSvgPlanElement(svg, element, stripePatternId) {
  const x = toSvgX(element.x);
  const y = element.y;
  const width = toSvgX(element.w);
  const height = element.h;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const transform = element.rotation ? `rotate(${element.rotation} ${centerX} ${centerY})` : undefined;
  const group = createSvgElement("g", {
    class: `floor-element floor-element-${element.type}`,
    ...(transform ? { transform } : {})
  });

  if (["boundary", "wall", "divider"].includes(element.type)) {
    const horizontal = width >= height;
    group.appendChild(createSvgElement("line", {
      x1: horizontal ? x : centerX,
      y1: horizontal ? centerY : y,
      x2: horizontal ? x + width : centerX,
      y2: horizontal ? centerY : y + height,
      class: `floor-structure-line floor-structure-${element.type}`
    }));
  } else if (element.type === "arrow") {
    group.appendChild(createSvgElement("text", { x: centerX, y: centerY, class: "floor-arrow" }, element.label || "→"));
  } else if (element.type === "label" && !isGenericPlanLabel(element.label)) {
    group.appendChild(createSvgElement("text", { x: centerX, y: centerY, class: "floor-label" }, element.label));
  } else if (element.type === "stripe") {
    group.appendChild(createSvgElement("rect", { x, y, width, height, fill: `url(#${stripePatternId})`, class: "floor-stripe" }));
  } else if (element.type === "stair") {
    group.appendChild(createSvgElement("rect", { x, y, width, height, class: "floor-room-shape" }));
    for (let step = 1; step < 7; step += 1) {
      const lineY = y + (height / 7) * step;
      group.appendChild(createSvgElement("line", { x1: x, x2: x + width, y1: lineY, y2: lineY, class: "floor-stair-line" }));
    }
  } else {
    group.appendChild(createSvgElement("rect", { x, y, width, height, class: "floor-element-shape" }));
    if (element.type === "lane") {
      if (width >= height) {
        group.appendChild(createSvgElement("line", { x1: x + 2, x2: x + width - 2, y1: centerY, y2: centerY, class: "floor-lane-center" }));
      } else {
        group.appendChild(createSvgElement("line", { x1: centerX, x2: centerX, y1: y + 2, y2: y + height - 2, class: "floor-lane-center" }));
      }
    }
    const labeledTypes = new Set(["room", "stair", "elevator", "entrance", "exit", "ramp", "column", "camera", "obstacle"]);
    const fallbackLabel = element.type === "elevator"
      ? "EV"
      : labeledTypes.has(element.type) ? element.label : "";
    if (fallbackLabel) {
      group.appendChild(createSvgElement("text", { x: centerX, y: centerY, class: "floor-element-label" }, fallbackLabel));
    }
  }
  svg.appendChild(group);
}

function renderAdminFloor() {
  const floor = state.floors[state.floorIndex];
  if (!floor) return;
  els.adminFloorName.textContent = floor.name;
  els.prevFloor.disabled = state.floorIndex === 0;
  els.nextFloor.disabled = state.floorIndex === state.floors.length - 1;
  renderFloorPlan(els.adminFloorPlan, floor, false);
}

async function handlePlanImageUpload() {
  await handlePlanFiles(Array.from(els.planImages.files || []));
}

async function handlePlanFiles(selectedFiles) {
  const files = selectedFiles.slice(0, 6);
  state.planImages = [];
  els.planImagePreview.replaceChildren();
  els.planImageCount.textContent = "사진을 읽는 중...";
  els.planUploadBox.classList.remove("has-files");

  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const image = await imageFileToGeminiPart(file);
    state.planImages.push(image);

    const preview = document.createElement("img");
    preview.src = image.previewUrl;
    preview.alt = file.name;
    els.planImagePreview.appendChild(preview);
  }

  els.planUploadBox.classList.toggle("has-files", state.planImages.length > 0);
  els.planImageCount.textContent = `선택된 사진 ${state.planImages.length}장`;
  els.geminiStatus.textContent = state.planImages.length
    ? `${state.planImages.length}장의 사진을 준비했습니다. 사진으로 도면 생성을 누르세요.`
    : "사진을 선택하지 않았습니다.";
}

async function generatePlanFromPrompt() {
  const floorNames = getRequestedFloorNames();

  if (state.planImages.length > 0 && !state.runtimeConfig?.geminiConfigured) {
    els.geminiStatus.textContent = "서버의 .env에 GEMINI_API_KEY를 설정해 주세요.";
    return;
  }

  if (state.planImages.length > 0) {
    try {
      const generatedFloors = [];
      for (let index = 0; index < floorNames.length; index += 1) {
        const floorName = floorNames[index];
        els.geminiStatus.textContent = `Gemini가 ${floorName} 도면을 생성하는 중입니다... (${index + 1}/${floorNames.length})`;
        const draftFloors = await generatePlanWithGemini(floorName, index, floorNames.length);
        els.geminiStatus.textContent = `Gemini가 ${floorName} 주차면 수와 배치를 다시 검수하는 중입니다...`;
        const reviewedFloors = await reviewPlanWithGemini(floorName, draftFloors[0]);
        generatedFloors.push(polishGeneratedFloor({ ...reviewedFloors[0], name: floorName }));
      }
      applyGeneratedFloors(generatedFloors);
      clearPlanImages();
      els.geminiStatus.textContent = `사진 기반 도면 생성 완료: ${generatedFloors.map((floor) => `${floor.name} ${floor.slots.length}면`).join(" / ")}`;
      setRegistrationStep(3);
      return;
    } catch (error) {
      els.geminiStatus.textContent = `Gemini 생성 실패: ${error.message}`;
      return;
    }
  } else {
    els.geminiStatus.textContent = "사진을 넣어야 사진과 맞는 도면을 만들 수 있습니다.";
    return;
  }
}

function generatePlanByRules(floorNames = getRequestedFloorNames()) {
  const prompt = els.planPrompt.value || DEFAULT_PLAN_INSTRUCTION;
  const normalCount = Number(prompt.match(/일반\s*주차\s*(\d+)/)?.[1] || prompt.match(/(\d+)\s*칸/)?.[1] || 12);
  const disabledCount = Number(prompt.match(/장애인\s*(\d+)/)?.[1] || 1);
  const pregnantCount = Number(prompt.match(/임산부\s*(\d+)/)?.[1] || 1);

  const floors = floorNames.map((name, floorIndex) => ({
    name,
    slots: layoutSlotsCleanly([
      ...Array.from({ length: disabledCount }, () => ({ kind: "disabled", status: "available" })),
      ...Array.from({ length: pregnantCount }, () => ({ kind: "pregnant", status: "available" })),
      ...Array.from({ length: Math.max(4, normalCount) }, () => ({
        kind: "normal",
        status: "occupied"
      }))
    ])
  }));

  applyGeneratedFloors(floors);
  clearPlanImages();
  els.geminiStatus.textContent = `규칙 기반 도면 생성 완료: ${floors.map((floor) => `${floor.name} ${floor.slots.length}면`).join(" / ")}`;
  setRegistrationStep(3);
}

function clearPlanImages() {
  state.planImages = [];
  els.planImages.value = "";
  els.planImagePreview.replaceChildren();
  els.planUploadBox.classList.remove("has-files");
  els.planImageCount.textContent = "선택된 사진 0장";
}

function getRequestedFloorNames() {
  const start = parseFloorName(els.floorStart.value, "B1");
  const end = parseFloorName(els.floorEnd.value, start.label);
  if (start.kind !== end.kind) return [start.label];

  const direction = start.number <= end.number ? 1 : -1;
  const floors = [];
  for (let number = start.number; direction > 0 ? number <= end.number : number >= end.number; number += direction) {
    floors.push(formatFloorName(start.kind, number));
  }
  return floors.slice(0, 8);
}

function parseFloorName(value, fallback) {
  const raw = String(value || fallback).trim().toUpperCase().replace(/\s+/g, "");
  const basement = raw.match(/^B(\d+)$/) || raw.match(/^지하(\d+)$/);
  if (basement) return { kind: "basement", number: Number(basement[1]), label: `B${Number(basement[1])}` };

  const ground = raw.match(/^(\d+)F?$/) || raw.match(/^(\d+)층$/);
  if (ground) return { kind: "ground", number: Number(ground[1]), label: `${Number(ground[1])}F` };

  return parseFloorName(fallback, "B1");
}

function formatFloorName(kind, number) {
  return kind === "basement" ? `B${number}` : `${number}F`;
}

async function generatePlanWithGemini(floorName, floorIndex, floorTotal) {
  const imageParts = state.planImages.map((image) => ({
    inline_data: {
      mime_type: image.mimeType,
      data: image.base64
    }
  }));

  const payload = await requestGeminiGeneration({
    contents: [
      {
        role: "user",
        parts: [
          { text: geminiPlanPrompt(floorName, floorIndex, floorTotal) },
          ...imageParts
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: floorPlanSchema()
    }
  });

  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!text) throw new Error("응답에 도면 JSON이 없습니다.");
  const parsed = JSON.parse(stripJsonFence(text));
  return validateGeneratedFloors(parsed);
}

async function reviewPlanWithGemini(floorName, draftFloor) {
  const imageParts = state.planImages.map((image) => ({
    inline_data: {
      mime_type: image.mimeType,
      data: image.base64
    }
  }));
  const payload = await requestGeminiGeneration({
    contents: [
      {
        role: "user",
        parts: [
          { text: geminiReviewPrompt(floorName, draftFloor) },
          ...imageParts
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: floorPlanSchema()
    }
  });

  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!text) throw new Error("검수 응답에 도면 JSON이 없습니다.");
  return validateGeneratedFloors(JSON.parse(stripJsonFence(text)));
}

async function requestGeminiGeneration(payload) {
  const response = await fetch(edgeApiUrl("/api/gemini/generate"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `AI 서버 HTTP ${response.status}`);
  }
  return result;
}

function geminiReviewPrompt(floorName, draftFloor) {
  const enteredTotal = Number(els.registerTotalSpaces?.value);
  const expectedTotal = enteredTotal > 0 ? `${enteredTotal}면` : `미입력(사진에서 직접 계산, 초안은 ${draftFloor.slots.length}면)`;
  const expectedDisabled = Math.max(0, Number(els.registerDisabledSpaces?.value) || 0);
  const expectedPregnant = Math.max(0, Number(els.registerPregnantSpaces?.value) || 0);
  return `
너는 주차장 사진과 1차 생성 도면을 대조하는 건축 CAD 검수자다. 초안의 숫자를 믿지 말고 사진 원본에서 주차면과 구조물을 독립적으로 다시 확인해 ${floorName} 도면 JSON 전체를 교정해라.

사용자 입력 참고값: 전체 예상 ${expectedTotal}, 장애인 ${expectedDisabled}면, 임산부 ${expectedPregnant}면. 입력 숫자를 맞추기 위해 사진에 없는 칸을 만들지 말고 사진을 우선한다.

검수 순서:
1. sourcePolygon은 카메라 원본 화면의 좌표다. 이 좌표만큼은 조감도 원근 보정을 적용하지 말고 사진에서 보이는 네 꼭짓점을 그대로 기록한다.
2. 사진에 빨강/초록 점선 사각형과 0/1 표시가 있으면 닫힌 사각형 하나를 주차면 하나로 보고, 각 사각형의 네 모서리와 서로 이웃한 면을 확인해라.
3. 빨강/초록 사각형이 표시된 사진에서는 그 사각형의 네 꼭짓점이 최종 배치의 절대 기준이다. sourcePolygon에 네 꼭짓점을 그대로 복사하고, 보기 좋게 일렬 정렬하거나 위치·간격·각도를 바꾸지 마라. x/y/w/h는 폴리곤이 없는 사진에서만 쓰는 예비값이다.
4. 카메라 화면에서 가까워서 크게 보이는 칸과 멀어서 작게 보이는 칸의 앞뒤·좌우 순서와 인접 관계를 절대 바꾸지 마라.
5. 서로 다른 깊이에 놓인 칸을 보기 좋다는 이유로 한 줄 가로 배열로 합치지 마라. 초안이 그렇게 되어 있으면 반드시 교정한다.
6. 사진의 가상 빨강/초록 테두리와 0/1은 슬롯 위치와 초기 점유 상태를 읽는 자료일 뿐 도면의 벽, 화살표, 장애인 표식이 아니다.
7. 장애인·임산부 kind는 바닥 도색이나 실제 표지가 사진에서 확인될 때만 사용한다. 입력 숫자만 보고 특수 칸을 만들지 마라.
8. 사진에 차량이 있거나 빨강/1이면 occupied, 차량이 없고 초록/0이면 available로 둔다.
9. 초안에 사진에 없는 칸·벽·화살표·출입구가 있으면 삭제하고, 빠진 칸과 구조가 있으면 추가한다.
10. detectedSlotCount와 slots 배열 길이를 반드시 같게 만든다.
11. 각 주차면은 sourcePolygon에 사진에서 보이는 실제 사각형을 기록한다. x/y/w/h는 폴리곤이 없을 때의 대체 렌더링용이다.
12. parking zone의 label은 빈 문자열로 두고 wall/divider/boundary에는 label을 넣지 않는다.
13. 각 slot의 sourcePolygon과 adjacentSlots가 사진 원본 및 최종 도면의 인접 관계와 일치하는지 확인한다.
14. 출력은 floorPlanSchema에 맞는 JSON만 반환한다.

1차 초안:
${JSON.stringify({ floors: [draftFloor] })}
`;
}

function geminiPlanPrompt(floorName, floorIndex, floorTotal) {
  const instruction = els.planPrompt.value || DEFAULT_PLAN_INSTRUCTION;
  const enteredTotal = Number(els.registerTotalSpaces?.value);
  const expectedTotal = enteredTotal > 0 ? `${enteredTotal}면` : "미입력(사진에서 직접 계산)";
  const expectedDisabled = Math.max(0, Number(els.registerDisabledSpaces?.value) || 0);
  const expectedPregnant = Math.max(0, Number(els.registerPregnantSpaces?.value) || 0);
  return `
너는 사진 측량 방식으로 건축 평면도를 복원하는 주차장 CAD 변환기다. 색칠된 주차칸 모음이나 예시 배치도를 만들지 말고, 사진 속 주차장을 천장에서 수직으로 내려다본 실제 2D 평면도처럼 원근을 보정해 복원해라.

사용자 입력 참고값: 전체 예상 ${expectedTotal}, 장애인 ${expectedDisabled}면, 임산부 ${expectedPregnant}면. 숫자를 맞추기 위해 사진에 없는 칸을 만들지 말고 사진을 우선한다.

반드시 아래 규칙을 지켜라.
- 출력은 JSON만 반환한다.
- 지금 생성할 층은 ${floorName}이다. 전체 ${floorTotal}개 층 중 ${floorIndex + 1}번째다.
- floors 배열에는 반드시 ${floorName} 한 층만 넣는다.
- outline은 건물 또는 주차장 바닥의 실제 외곽선을 시계방향으로 기록한 점 배열이다. 직사각형으로 단순화하지 말고 사진에 보이는 돌출부, 꺾인 벽, 잘린 모서리를 모두 반영한다.
- zones에는 parking, room, core, outdoor 구역을 다각형으로 분리해 넣는다. parking은 실제 차량 통행·주차 영역, room/core는 계단실·승강기실·기계실 같은 비주차 공간이다.
- 각 zone의 points도 외곽을 따라 순서대로 기록하고 label에는 사진에서 확인되는 짧은 공간명만 넣는다.
- JSON을 작성하기 전에 바닥 평면의 소실점과 평행 방향을 찾고, 사진을 천장에서 내려다본 조감도로 원근 보정했다고 가정한 뒤 좌표를 정해라.
- 사진에 빨강/초록 점선 사각형과 0/1 표시가 있으면 닫힌 사각형 하나를 주차면 하나로 본다. 각 사각형의 네 모서리, 앞뒤 순서, 좌우 이웃 관계를 먼저 확인한다.
- 빨강/초록 사각형이 이미 표시되어 있으면 그 사각형의 네 꼭짓점을 sourcePolygon에 그대로 복사한다. 이것이 최종 주차면 위치의 절대 기준이며, 일렬 정렬·간격 보정·회전 보정·재배치를 하지 않는다.
- 표시된 사각형이 있는 경우 x/y/w/h는 sourcePolygon이 없을 때만 쓰는 예비값이다. 최종 화면은 sourcePolygon을 직접 렌더링하므로 다섯 사각형이 사진에서 차지한 상대 위치와 원근을 그대로 유지해야 한다.
- x/y/w/h에는 필요하면 조감도용 값을 기록할 수 있지만 sourcePolygon은 카메라 사진에서 가까운 칸과 먼 칸의 크기·기울기 차이까지 그대로 보존한다.
- 빨강/초록 테두리와 0/1은 슬롯 경계와 점유 상태를 읽는 참고 정보일 뿐, 도면에 색 면·숫자·장식으로 그리지 않는다.
- detectedSlotCount에는 사진에서 센 전체 주차면 수를 넣고, slots 배열에도 정확히 같은 개수의 객체를 넣어라.
- 반복되는 주차면을 대표 3~4칸으로 줄이거나 생략하면 안 된다. 사진에 보이는 주차면 하나당 slot 객체가 반드시 하나 있어야 한다.
- 좌표는 전체 도면 기준 퍼센트이며 0~100 범위다.
- slot의 x, y는 좌상단 기준이다.
- slot의 w, h는 폭과 높이다.
- slot의 rotation은 위에서 본 도면에서의 회전 각도이며 -180~180 범위다.
- slot의 sourcePolygon은 카메라 원본 사진에서 해당 주차면의 네 모서리를 사진 기준 0~100 좌표로 시계방향 기록한다.
- slot의 adjacentSlots에는 원본 사진에서 경계를 맞대거나 바로 이웃한 다른 주차면의 1부터 시작하는 번호를 넣는다.
- kind는 normal, disabled, pregnant 중 하나다.
- status는 occupied 또는 available 중 하나다.
- 사진에 차량이 있거나 빨강/1로 표시된 칸은 occupied, 차량이 없고 초록/0으로 표시된 칸은 available로 둔다.
- 장애인 주차면은 실제 휠체어 바닥 도색이나 표지가 보일 때만 disabled로 둔다.
- 임산부/여성 우선 주차면은 실제 바닥 도색이나 표지가 보일 때만 pregnant로 둔다.
- 사용자 입력에 장애인·임산부 숫자가 있어도 사진에서 위치를 확인할 수 없으면 일반 칸을 임의로 특수 칸으로 바꾸지 않는다.
- 파란 바탕의 휠체어 표시는 disabled로, 분홍 바탕의 특수 주차 표시는 pregnant로 분류한다.
- 사진에 보이지 않는 구조를 임의로 추가하지 않되, 사진에 보이는 벽과 통행 공간은 반드시 도면 요소로 만든다.
- 사진 바깥의 책상, 케이블, 손, 의자 같은 배경은 모두 무시하고 주차 보드만 도면 전체에 맞춰 사용한다.
- 사진에 보이는 벽, 차로, 입구, 계단, 승강기, 문, 카메라/기둥/장애물, 라벨은 elements 배열로 만든다.
- elements의 type은 boundary, wall, divider, lane, room, stair, elevator, door, entrance, exit, ramp, column, camera, obstacle, label, stripe, arrow 중 하나다.
- 기울어진 벽이나 요소는 rotation에 각도를 넣는다. 외곽 전체를 하나의 큰 사각형으로 덮어 구조를 숨기면 안 된다.
- 사선 완충 구역과 방향 화살표는 사진 바닥에 실제로 그려져 있을 때만 만든다. CCTV 오버레이의 선이나 숫자를 구조물로 해석하지 않는다.
- 주차면은 사진에서 보이는 위치와 방향을 우선한다. 앱이 보기 좋게 만들려고 임의로 상단/하단/좌우 템플릿에 맞추지 않는다.
- 주차면이 행(row)이나 열(column)을 이루면 개수, 앞뒤·좌우 순서, 간격, 방향을 그대로 유지한다. 사진의 깊이 방향 배치를 임의의 가로 한 줄로 펴지 않는다.
- sourcePolygon에서 확인한 인접 관계가 최종 x, y, rotation 배치에서도 유지되어야 한다.
- 주차면 하나는 실제 약 2.3~2.5m × 5m 비율처럼 짧은 변 대비 긴 변이 1.8~2.4배인 직사각형이어야 한다. 정사각형이나 작은 막대로 만들지 않는다.
- 사진 중앙이 비어 있으면 빈 공간으로 남기고, 사진 중앙에 구조물이 있으면 obstacle 또는 label로 표시한다.
- 주차면끼리 절대 겹치지 않게 배치한다.
- 장애인/임산부 특수 주차면도 사진에 보이는 실제 위치에 둔다.
- 보드가 가로로 길면 도면도 가로형으로 구성하고, 중앙 차로가 넓으면 그 비율을 줄이지 않는다.
- 벽은 wall 또는 boundary, 차량 통행 공간은 lane, 출입구는 entrance/exit, 경사로는 ramp, 기둥은 column으로 구분한다.
- 결과는 색칠된 칸 표가 아니라 건축 도면이어야 한다. 비주차 실은 흰 공간, 주차 구역은 별도 zone, 벽은 가는 이중선, 주차면은 얇은 경계선으로 읽혀야 한다.
- lane은 주차면 아래에 넓은 면으로 배치하고 arrow는 lane 위에 둔다. 주차면과 차로가 겹치면 안 된다.
- 슬롯 번호나 임의의 숫자는 elements 또는 slots에 추가하지 않는다.
- parking zone의 label은 빈 문자열로 두고, wall/divider/boundary에 "좌측 벽", "우측 벽", "주차구역" 같은 설명용 label을 넣지 않는다.
- outline이 외곽선을 나타내므로 동일한 외곽을 boundary element로 중복 생성하지 않는다.
- 응답 직전에 detectedSlotCount와 slots.length가 같은지 다시 확인한다.
- 사진이 여러 층을 직접 구분하지 못하면 층마다 같은 구조를 쓰되 일부 주차 상태만 다르게 둔다.

내부 지시:
${instruction}
`;
}

function floorPlanSchema() {
  return {
    type: "OBJECT",
    properties: {
      floors: {
        type: "ARRAY",
        minItems: 1,
        items: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            outline: {
              type: "ARRAY",
              minItems: 3,
              items: {
                type: "OBJECT",
                properties: {
                  x: { type: "NUMBER" },
                  y: { type: "NUMBER" }
                },
                required: ["x", "y"]
              }
            },
            zones: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  type: { type: "STRING", enum: ["parking", "room", "core", "outdoor"] },
                  label: { type: "STRING" },
                  points: {
                    type: "ARRAY",
                    minItems: 3,
                    items: {
                      type: "OBJECT",
                      properties: {
                        x: { type: "NUMBER" },
                        y: { type: "NUMBER" }
                      },
                      required: ["x", "y"]
                    }
                  }
                },
                required: ["type", "points"]
              }
            },
            elements: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  type: { type: "STRING", enum: ["boundary", "wall", "divider", "lane", "room", "stair", "elevator", "door", "entrance", "exit", "ramp", "column", "camera", "obstacle", "label", "stripe", "arrow"] },
                  label: { type: "STRING" },
                  x: { type: "NUMBER" },
                  y: { type: "NUMBER" },
                  w: { type: "NUMBER" },
                  h: { type: "NUMBER" },
                  rotation: { type: "NUMBER" }
                },
                required: ["type", "x", "y", "w", "h"]
              }
            },
            detectedSlotCount: { type: "INTEGER" },
            slots: {
              type: "ARRAY",
              minItems: 1,
              items: {
                type: "OBJECT",
                properties: {
                  kind: { type: "STRING", enum: ["normal", "disabled", "pregnant"] },
                  status: { type: "STRING", enum: ["occupied", "available"] },
                  x: { type: "NUMBER" },
                  y: { type: "NUMBER" },
                  w: { type: "NUMBER" },
                  h: { type: "NUMBER" },
                  rotation: { type: "NUMBER" },
                  sourcePolygon: {
                    type: "ARRAY",
                    minItems: 4,
                    items: {
                      type: "OBJECT",
                      properties: {
                        x: { type: "NUMBER" },
                        y: { type: "NUMBER" }
                      },
                      required: ["x", "y"]
                    }
                  },
                  adjacentSlots: {
                    type: "ARRAY",
                    items: { type: "INTEGER" }
                  }
                },
                required: ["kind", "status", "x", "y", "w", "h", "rotation", "sourcePolygon", "adjacentSlots"]
              }
            }
          },
          required: ["name", "outline", "zones", "detectedSlotCount", "slots"]
        }
      }
    },
    required: ["floors"]
  };
}

function validateGeneratedFloors(plan) {
  const floors = Array.isArray(plan?.floors) ? plan.floors : [];
  const validFloors = floors.map((floor, floorIndex) => {
    const slots = Array.isArray(floor.slots)
      ? floor.slots.map(normalizeGeneratedSlot).filter(Boolean)
      : [];
    return {
      name: String(floor.name || `B${floorIndex + 1}`),
      detectedSlotCount: Number(floor.detectedSlotCount),
      outline: normalizeFloorPoints(floor.outline, 3),
      zones: Array.isArray(floor.zones)
        ? floor.zones.map(normalizeGeneratedZone).filter(Boolean)
        : [],
      elements: Array.isArray(floor.elements)
        ? floor.elements.map(normalizeGeneratedElement).filter(Boolean)
        : [],
      slots
    };
  }).filter((floor) => floor.slots.length > 0);

  if (validFloors.length === 0) throw new Error("유효한 주차면이 없습니다.");
  const mismatchedFloor = validFloors.find((floor) => (
    Number.isFinite(floor.detectedSlotCount) && floor.detectedSlotCount !== floor.slots.length
  ));
  if (mismatchedFloor) {
    throw new Error(`Gemini가 센 ${mismatchedFloor.detectedSlotCount}면과 생성한 ${mismatchedFloor.slots.length}면이 달라 도면을 적용하지 않았습니다. 다시 생성해 주세요.`);
  }
  return validFloors.slice(0, 8);
}

function normalizeGeneratedElement(element) {
  const type = ["boundary", "wall", "divider", "lane", "room", "stair", "elevator", "door", "entrance", "exit", "ramp", "column", "camera", "obstacle", "label", "stripe", "arrow"].includes(element.type)
    ? element.type
    : "obstacle";
  const x = clamp(Number(element.x), 0, 98);
  const y = clamp(Number(element.y), 0, 98);
  const w = clamp(Number(element.w), 1, 100);
  const h = clamp(Number(element.h), 1, 100);

  if (![x, y, w, h].every(Number.isFinite)) return null;
  return {
    type,
    label: String(element.label || "").slice(0, 12),
    x: Math.min(x, 100 - w),
    y: Math.min(y, 100 - h),
    w,
    h,
    rotation: clamp(Number(element.rotation) || 0, -180, 180)
  };
}

function normalizeFloorPoints(points, minimum = 3) {
  if (!Array.isArray(points)) return [];
  const normalized = points.map((point) => ({
    x: clamp(Number(point?.x), 0.5, 99.5),
    y: clamp(Number(point?.y), 0.5, 99.5)
  })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  return normalized.length >= minimum ? normalized.slice(0, 40) : [];
}

function normalizeGeneratedZone(zone) {
  const type = ["parking", "room", "core", "outdoor"].includes(zone?.type) ? zone.type : "parking";
  const points = normalizeFloorPoints(zone?.points, 3);
  if (points.length < 3) return null;
  return {
    type,
    label: String(zone?.label || "").slice(0, 16),
    points
  };
}

function normalizeGeneratedSlot(slot) {
  const kind = ["normal", "disabled", "pregnant"].includes(slot.kind) ? slot.kind : "normal";
  const status = slot.status === "available" ? "available" : "occupied";
  const rawX = Number(slot.x);
  const rawY = Number(slot.y);
  const rawW = Number(slot.w);
  const rawH = Number(slot.h);

  if (![rawX, rawY, rawW, rawH].every(Number.isFinite)) return null;
  const { x, y, w, h } = normalizeParkingSlotRect(rawX, rawY, rawW, rawH);
  return {
    kind,
    status,
    x,
    y,
    w,
    h,
    rotation: clamp(Number(slot.rotation) || 0, -180, 180),
    sourcePolygon: normalizeFloorPoints(slot.sourcePolygon, 4).slice(0, 4),
    adjacentSlots: Array.isArray(slot.adjacentSlots)
      ? slot.adjacentSlots.map(Number).filter((value) => Number.isInteger(value) && value > 0).slice(0, 8)
      : []
  };
}

function normalizeParkingSlotRect(rawX, rawY, rawW, rawH) {
  const centerX = clamp(rawX + rawW / 2, 4, 96);
  const centerY = clamp(rawY + rawH / 2, 4, 96);
  const horizontal = rawW >= rawH;
  let w;
  let h;

  if (horizontal) {
    w = clamp(rawW, 12, 28);
    h = clamp(rawH, 8, 18);
    if (w / h < 1.15) w = Math.min(28, h * 1.15);
    if (w / h > 1.55) h = w / 1.55;
  } else {
    w = clamp(rawW, 4.5, 10);
    h = clamp(rawH, 14, 30);
    if (h / w < 2.8) h = Math.min(30, w * 2.8);
    if (h / w > 3.8) w = h / 3.8;
  }

  return {
    x: clamp(centerX - w / 2, 2, 98 - w),
    y: clamp(centerY - h / 2, 2, 98 - h),
    w,
    h
  };
}

function polishGeneratedFloor(floor) {
  return {
    name: floor.name,
    outline: normalizeFloorPoints(floor.outline, 3),
    zones: Array.isArray(floor.zones)
      ? floor.zones.map(normalizeGeneratedZone).filter(Boolean).map((zone) => ({
        ...zone,
        label: zone.type === "parking" ? "" : zone.label
      }))
      : [],
    elements: (floor.elements || []).map(cleanGeneratedElement).filter(Boolean),
    slots: preserveGeneratedLayout(floor.slots || [])
  };
}

function cleanGeneratedElement(element) {
  if (!element || element.type === "boundary") return null;
  if (element.type === "label" && isGenericPlanLabel(element.label)) return null;
  if (["wall", "divider", "lane", "stripe"].includes(element.type)) {
    return { ...element, label: "" };
  }
  return element;
}

function isGenericPlanLabel(value) {
  return /^(주차장|주차구역|주차 영역|좌측 ?벽|우측 ?벽|상단 ?벽|하단 ?벽|외벽|차로)$/.test(String(value || "").trim());
}

function preserveGeneratedLayout(slots) {
  const preserved = [];

  slots.slice(0, 80).forEach((slot) => {
    const clean = {
      ...slot,
      x: clamp(Number(slot.x), 1, 99 - Number(slot.w)),
      y: clamp(Number(slot.y), 1, 99 - Number(slot.h)),
      w: clamp(Number(slot.w), 5.5, 30),
      h: clamp(Number(slot.h), 5.5, 30)
    };
    const duplicate = preserved.some((existing) => (
      Math.abs(existing.x - clean.x) < 0.5 &&
      Math.abs(existing.y - clean.y) < 0.5 &&
      Math.abs(existing.w - clean.w) < 0.5 &&
      Math.abs(existing.h - clean.h) < 0.5
    ));
    if (!duplicate) preserved.push(clean);
  });

  return preserved;
}

function layoutSlotsCleanly(slots) {
  return addSlotSpacing(resolveSlotOverlaps(slots));
}

function addSlotSpacing(slots) {
  const arranged = slots.slice(0, 40).map((slot) => ({
    ...slot,
    x: clamp(Number(slot.x), 2, 98 - Number(slot.w || 8)),
    y: clamp(Number(slot.y), 2, 98 - Number(slot.h || 8)),
    w: clamp(Number(slot.w), 7, 28),
    h: clamp(Number(slot.h), 6, 26)
  }));
  const minGap = 4.2;

  for (let iteration = 0; iteration < 18; iteration += 1) {
    let moved = false;
    for (let i = 0; i < arranged.length; i += 1) {
      for (let j = i + 1; j < arranged.length; j += 1) {
        const a = arranged[i];
        const b = arranged[j];
        if (!slotsOverlap(a, b, minGap)) continue;

        const ax = a.x + a.w / 2;
        const ay = a.y + a.h / 2;
        const bx = b.x + b.w / 2;
        const by = b.y + b.h / 2;
        const overlapX = Math.min(a.x + a.w + minGap - b.x, b.x + b.w + minGap - a.x);
        const overlapY = Math.min(a.y + a.h + minGap - b.y, b.y + b.h + minGap - a.y);

        if (overlapX <= overlapY) {
          const dir = ax <= bx ? -1 : 1;
          const shift = overlapX / 2 + 0.35;
          a.x = clamp(a.x + dir * shift, 2, 98 - a.w);
          b.x = clamp(b.x - dir * shift, 2, 98 - b.w);
        } else {
          const dir = ay <= by ? -1 : 1;
          const shift = overlapY / 2 + 0.35;
          a.y = clamp(a.y + dir * shift, 2, 98 - a.h);
          b.y = clamp(b.y - dir * shift, 2, 98 - b.h);
        }
        moved = true;
      }
    }
    if (!moved) break;
  }

  return arranged;
}

function buildStructuredGarageLayout(slots) {
  const sourceSlots = Array.isArray(slots) ? slots : [];
  const disabled = sourceSlots.filter((slot) => slot.kind === "disabled");
  const pregnant = sourceSlots.filter((slot) => slot.kind === "pregnant");
  const normal = sourceSlots.filter((slot) => slot.kind !== "disabled" && slot.kind !== "pregnant");
  const arranged = [];

  const specialPositions = [
    { x: 4, y: 17, w: 8.5, h: 18 },
    { x: 12.5, y: 17, w: 8.5, h: 18 },
    { x: 25.5, y: 17, w: 8.5, h: 18 },
    { x: 82.5, y: 17, w: 8.5, h: 18 }
  ];

  disabled.forEach((slot, index) => {
    const position = specialPositions[index] || nextGaragePosition(arranged.length);
    arranged.push(makeStructuredSlot(slot, position, "disabled"));
  });

  pregnant.forEach((slot, index) => {
    const position = specialPositions[disabled.length + index] || nextGaragePosition(arranged.length);
    arranged.push(makeStructuredSlot(slot, position, "pregnant"));
  });

  normal.forEach((slot, index) => {
    arranged.push(makeStructuredSlot(slot, nextGaragePosition(index), "normal"));
  });

  return resolveSlotOverlaps(arranged).slice(0, 40);
}

function makeStructuredSlot(slot, position, kind) {
  return {
    kind,
    status: slot.status === "available" ? "available" : "occupied",
    x: position.x,
    y: position.y,
    w: position.w,
    h: position.h,
    rotation: clamp(Number(slot.rotation) || 0, -180, 180),
    sourceStatus: slot.status
  };
}

function nextGaragePosition(index) {
  const positions = [
    ...garagePhotoRow([34, 42.5, 51], 17),
    ...garagePhotoRow([62, 70.5, 79, 87.5], 17),
    ...garagePhotoRow([4, 12.5, 21], 73),
    ...garagePhotoRow([34, 42.5, 51], 73),
    ...garagePhotoRow([55.5, 64, 72.5], 73),
    ...garagePhotoRow([81, 89.5], 73),
    ...garagePhotoRow([38.5, 47, 55.5], 24)
  ];

  if (index < positions.length) return positions[index];

  const extra = index - positions.length;
  const column = extra % 4;
  const row = Math.floor(extra / 4);
  return {
    x: 4 + column * 23,
    y: 13 + (row % 5) * 16,
    w: 8.5,
    h: 18
  };
}

function garagePhotoRow(xs, y) {
  return xs.map((x) => ({
    x,
    y,
    w: 8.5,
    h: 18
  }));
}

function resolveSlotOverlaps(slots) {
  const arranged = [];

  slots.forEach((slot, index) => {
    const candidate = {
      kind: slot.kind,
      status: slot.status === "available" ? "available" : "occupied",
      x: clamp(Number(slot.x), 2, 92),
      y: clamp(Number(slot.y), 2, 92),
      w: clamp(Number(slot.w), 6, 28),
      h: clamp(Number(slot.h), 5, 22),
      rotation: clamp(Number(slot.rotation) || 0, -180, 180)
    };

    candidate.x = Math.min(candidate.x, 98 - candidate.w);
    candidate.y = Math.min(candidate.y, 98 - candidate.h);

    let attempts = 0;
    while (arranged.some((existing) => slotsOverlap(candidate, existing)) && attempts < 24) {
      candidate.x = 2 + ((candidate.x + 8 + index * 3) % Math.max(8, 96 - candidate.w));
      candidate.y = 2 + ((candidate.y + 7 + index * 2) % Math.max(8, 96 - candidate.h));
      attempts += 1;
    }

    arranged.push(candidate);
  });

  return arranged.slice(0, 40);
}

function slotsOverlap(a, b, padding = 1.6) {
  return !(
    a.x + a.w + padding <= b.x ||
    b.x + b.w + padding <= a.x ||
    a.y + a.h + padding <= b.y ||
    b.y + b.h + padding <= a.y
  );
}

function applyGeneratedFloors(floors) {
  state.floors = floors;
  state.floorIndex = 0;
  state.currentImage = null;
  state.detections = [];
  state.emptyYoloStreak = 0;
  state.baselineMetrics = new Map();
  renderAdminFloor();
}

async function imageFileToGeminiPart(file) {
  const dataUrl = await resizeImageFile(file, 1600, 0.9);
  const [, meta, base64] = dataUrl.match(/^data:(.+);base64,(.+)$/) || [];
  return {
    mimeType: meta || "image/jpeg",
    base64,
    previewUrl: dataUrl
  };
}

function resizeImageFile(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name} 이미지를 읽지 못했습니다.`));
    };
    img.src = url;
  });
}

function stripJsonFence(text) {
  return text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
}

function applyServerSlotResults(slotResults) {
  const floor = state.floors[state.floorIndex];
  if (!floor) return { available: 0, occupied: 0, mapped: 0, unreliable: true };

  const resultsByIndex = new Map(
    slotResults.map((result) => [Number(result.slot_index), result])
  );
  if (resultsByIndex.size === 0) {
    return { ...countFloorStatus(floor), mapped: 0, unreliable: true };
  }

  floor.slots.forEach((slot, slotIndex) => {
    const result = resultsByIndex.get(slotIndex);
    if (!result) return;
    slot.status = result.status === "occupied" ? "occupied" : "available";
  });
  refreshParkingStateViews();
  return { ...countFloorStatus(floor), mapped: resultsByIndex.size, ignored: 0 };
}

function countFloorStatus(floor) {
  return {
    available: floor.slots.filter((slot) => slot.status === "available").length,
    occupied: floor.slots.filter((slot) => slot.status === "occupied").length
  };
}

function refreshParkingStateViews() {
  syncSelectedLotFromAdmin();
  renderAdminFloor();
  renderManagementFloor();
  renderList();
  renderMapMarkers();
  if (state.selectedLot && els.detailView.classList.contains("active")) {
    renderLotDetail(state.selectedLot);
  }
}

function syncSelectedLotFromAdmin() {
  if (!state.selectedLot) return;
  state.selectedLot.floors = state.floors;
  const slots = state.floors.flatMap((floor) => floor.slots);
  state.selectedLot.totalSpaces = slots.length;
  state.selectedLot.availableSpaces = slots.filter((slot) => slot.status === "available").length;
  if (state.selectedLot.isRegistered) {
    const index = state.registeredLots.findIndex((lot) => lot.id === state.selectedLot.id);
    if (index >= 0) state.registeredLots[index] = state.selectedLot;
    saveRegisteredLots();
  }
}

async function refreshEdgeStatus() {
  try {
    const [healthResponse, resultResponse] = await Promise.all([
      fetch(edgeApiUrl("/api/health"), { cache: "no-store" }),
      fetch(edgeApiUrl("/api/result"), { cache: "no-store" })
    ]);
    if (!healthResponse.ok) throw new Error(`분석 서버 HTTP ${healthResponse.status}`);

    const health = await healthResponse.json();
    const result = resultResponse.ok ? await resultResponse.json() : null;
    const cameraConnected = health.camera?.connected === true;
    const configured = health.camera?.configured === true;
    const manualMode = !cameraConnected;

    els.cameraConnectionChip.textContent = cameraConnected ? "CCTV 연결됨" : "수동 관리";
    els.cameraConnectionChip.classList.toggle("is-live", cameraConnected);
    els.cameraConnectionChip.classList.remove("is-error");
    els.cameraConnectionChip.classList.toggle("is-manual", manualMode);
    els.cameraStatus.textContent = cameraConnected
      ? "정상"
      : configured ? "연결 대기" : "선택 연결";

    const currentFloor = state.floors[state.floorIndex];
    const matchesCurrentFloor = !result?.floor_id || result.floor_id === currentFloor?.name;

    if (cameraConnected && result?.slot_results?.length && matchesCurrentFloor) {
      const counts = applyServerSlotResults(result.slot_results);
      els.analysisStatus.textContent = formatAnalysisTime(result.analyzed_at);
      els.objectStatus.textContent = `현재 가능 ${counts.available}면 · 주차중 ${counts.occupied}면`;
    } else if (cameraConnected && result?.slot_results?.length && !matchesCurrentFloor) {
      els.analysisStatus.textContent = "이 층 결과 없음";
      els.objectStatus.textContent = `${result.floor_id} 카메라만 연결되어 있습니다.`;
    } else if (manualMode) {
      els.analysisStatus.textContent = "수동";
      els.objectStatus.textContent = "카메라 없이 도면의 주차면을 눌러 상태를 직접 변경할 수 있습니다.";
    } else {
      els.analysisStatus.textContent = health.last_analysis_at
        ? formatAnalysisTime(health.last_analysis_at)
        : "대기 중";
      els.objectStatus.textContent = health.last_error
        ? `분석 대기: ${health.last_error}`
        : "현장 분석 서비스가 30초마다 주차면 상태를 갱신합니다.";
    }
  } catch (error) {
    els.cameraConnectionChip.textContent = "수동 관리";
    els.cameraConnectionChip.classList.remove("is-live");
    els.cameraConnectionChip.classList.remove("is-error");
    els.cameraConnectionChip.classList.add("is-manual");
    els.cameraStatus.textContent = "선택 연결";
    els.analysisStatus.textContent = "수동";
    els.objectStatus.textContent = "카메라 없이 도면 생성·등록·주차면 상태 변경을 사용할 수 있습니다.";
  }
}

function formatAnalysisTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "방금 전";
  return date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function startEdgeStatusPolling() {
  if (state.edgeStatusTimer) return;
  refreshEdgeStatus();
  state.edgeStatusTimer = window.setInterval(refreshEdgeStatus, 5000);
}

function stopEdgeStatusPolling() {
  if (state.edgeStatusTimer) window.clearInterval(state.edgeStatusTimer);
  state.edgeStatusTimer = null;
}

function showScreen(screen) {
  els.userScreen.classList.toggle("active", screen === "user");
  els.adminScreen.classList.toggle("active", screen === "admin");

  if (screen === "admin" && els.managementView?.classList.contains("active")) {
    startEdgeStatusPolling();
  } else {
    stopEdgeStatusPolling();
  }
}

function onSheetPointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return;
  const rect = els.bottomSheet.getBoundingClientRect();
  state.sheetDrag = {
    pointerId: event.pointerId,
    startY: event.clientY,
    startHeight: rect.height,
    lastY: event.clientY,
    lastTime: performance.now(),
    velocityY: 0
  };
  els.sheetHandle.setPointerCapture(event.pointerId);
  els.bottomSheet.classList.add("is-dragging");
}

function onSheetPointerMove(event) {
  if (!state.sheetDrag || state.sheetDrag.pointerId !== event.pointerId) return;
  const now = performance.now();
  const elapsed = Math.max(1, now - state.sheetDrag.lastTime);
  state.sheetDrag.velocityY = (event.clientY - state.sheetDrag.lastY) / elapsed;
  state.sheetDrag.lastY = event.clientY;
  state.sheetDrag.lastTime = now;
  const delta = state.sheetDrag.startY - event.clientY;
  applyBottomSheetHeight(state.sheetDrag.startHeight + delta);
}

function onSheetPointerUp(event) {
  if (!state.sheetDrag || state.sheetDrag.pointerId !== event.pointerId) return;
  const finalHeight = els.bottomSheet.getBoundingClientRect().height;
  const velocityY = state.sheetDrag.velocityY;
  state.sheetDrag = null;
  els.bottomSheet.classList.remove("is-dragging");
  const bounds = bottomSheetBounds();
  const shouldFillScreen = finalHeight > bounds.max - 52
    || (velocityY < -0.55 && finalHeight > bounds.medium);
  applyBottomSheetHeight(shouldFillScreen ? bounds.max : finalHeight, true);
  renderList();
  renderMapMarkers();
}

function onSheetHandleKeyDown(event) {
  if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(event.key)) return;
  event.preventDefault();
  const direction = event.key === "ArrowUp" || event.key === "PageUp" ? 1 : -1;
  const step = event.key === "PageUp" || event.key === "PageDown" ? 96 : 40;
  const currentHeight = els.bottomSheet.getBoundingClientRect().height;
  applyBottomSheetHeight(currentHeight + direction * step, true);
  renderList();
  renderMapMarkers();
}

function bottomSheetBounds() {
  const min = Math.max(170, window.innerHeight * 0.22);
  const max = Math.max(min, window.innerHeight);
  const medium = clamp(window.innerHeight * 0.57, min, max);
  return { min, medium, max };
}

function applyBottomSheetHeight(requestedHeight, animate = false) {
  const bounds = bottomSheetBounds();
  const nextHeight = clamp(requestedHeight, bounds.min, bounds.max);
  const progress = (nextHeight - bounds.min) / Math.max(1, bounds.max - bounds.min);
  state.sheetHeight = nextHeight;
  els.bottomSheet.classList.toggle("is-animating", animate);
  els.bottomSheet.style.height = `${nextHeight}px`;
  els.bottomSheet.style.setProperty("--sheet-progress", progress.toFixed(3));
  els.bottomSheet.classList.toggle("expanded", nextHeight > bounds.medium + 12);
  els.bottomSheet.classList.toggle("sheet-full", nextHeight >= bounds.max - 2);
  els.sheetHandle.setAttribute("aria-valuenow", String(Math.round(nextHeight / window.innerHeight * 100)));
  positionMainMapControls();
  if (animate) {
    window.setTimeout(() => els.bottomSheet.classList.remove("is-animating"), 320);
  }
}

function expandBottomSheetToFull() {
  applyBottomSheetHeight(bottomSheetBounds().max, true);
  renderList();
  renderMapMarkers();
}

function setSetupStep(step) {
  state.setupStep = SETUP_STEPS.includes(step) ? step : "plan";

  els.setupPanels.forEach((panel) => {
    panel.classList.add("active");
  });

  if (els.prevSetupButton && els.nextSetupButton) {
    const index = SETUP_STEPS.indexOf(state.setupStep);
    els.prevSetupButton.disabled = index === 0;
    els.nextSetupButton.textContent = index === SETUP_STEPS.length - 1 ? "사용자 화면" : "다음";
  }
}

function moveSetupStep(direction) {
  const index = SETUP_STEPS.indexOf(state.setupStep);
  if (direction > 0 && index === SETUP_STEPS.length - 1) {
    showScreen("user");
    return;
  }

  const nextIndex = clamp(index + direction, 0, SETUP_STEPS.length - 1);
  setSetupStep(SETUP_STEPS[nextIndex]);
}

function onPointerDown(event) {
  if (state.mapMode !== "fallback") return;
  els.mapStage.setPointerCapture(event.pointerId);
  state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (state.pointers.size === 2) {
    const points = Array.from(state.pointers.values());
    state.pinch = {
      distance: distance(points[0], points[1]),
      scale: state.transform.scale,
      centerX: (points[0].x + points[1].x) / 2,
      centerY: (points[0].y + points[1].y) / 2
    };
    state.dragging = null;
    return;
  }

  state.dragging = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    startX: state.transform.x,
    startY: state.transform.y
  };
}

function onFallbackMapClick(event) {
  if (state.mapMode !== "fallback") return;
  if (event.target.closest(".parking-marker, .compact-parking-marker")) return;
  hideBottomSheet();
}

function onPointerMove(event) {
  if (state.mapMode !== "fallback") return;
  if (state.pointers.has(event.pointerId)) {
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  if (state.pointers.size === 2 && state.pinch) {
    const points = Array.from(state.pointers.values());
    const nextDistance = distance(points[0], points[1]);
    const centerX = (points[0].x + points[1].x) / 2;
    const centerY = (points[0].y + points[1].y) / 2;
    zoomAt(centerX, centerY, state.pinch.scale * (nextDistance / state.pinch.distance));
    return;
  }

  if (!state.dragging || state.dragging.id !== event.pointerId) return;
  state.transform.x = state.dragging.startX + event.clientX - state.dragging.x;
  state.transform.y = state.dragging.startY + event.clientY - state.dragging.y;
  constrainTransform();
  applyTransform();
}

function onPointerUp(event) {
  if (state.mapMode !== "fallback") return;
  state.pointers.delete(event.pointerId);
  state.dragging = null;
  if (state.pointers.size < 2) state.pinch = null;
  renderList();
}

function onWheel(event) {
  if (state.mapMode !== "fallback") return;
  event.preventDefault();
  const delta = event.deltaY > 0 ? -0.18 : 0.18;
  zoomAt(event.clientX, event.clientY, state.transform.scale + delta);
}

function zoomAt(clientX, clientY, nextScale) {
  const rect = els.mapStage.getBoundingClientRect();
  const oldScale = state.transform.scale;
  const scale = clamp(nextScale, FALLBACK_MAP_MIN_SCALE, 8);
  const worldX = (clientX - rect.left - state.transform.x) / oldScale;
  const worldY = (clientY - rect.top - state.transform.y) / oldScale;
  state.transform.scale = scale;
  state.transform.x = clientX - rect.left - worldX * scale;
  state.transform.y = clientY - rect.top - worldY * scale;
  constrainTransform();
  applyTransform();
  updateMapNavigationControls();
  renderMarkers();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

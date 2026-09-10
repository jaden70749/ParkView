const KOREA_BOUNDS = {
  minLat: 33.0,
  maxLat: 38.9,
  minLng: 124.5,
  maxLng: 131.9
};

const EDGE_API_BASE_URL = String(
  window.PARKVIEW_CONFIG?.edgeApiBaseUrl || ""
).trim().replace(/\/+$/, "");
const CAMERA_API_BASE_URL = String(
  window.PARKVIEW_CONFIG?.cameraApiBaseUrl || ""
).trim().replace(/\/+$/, "");
const CAMERA_ADMIN_TOKEN_SESSION = "parkview.cameraAdminToken.session";
const DIRECT_CAMERA_LINK_SESSION = "parkview.directCameraLink.session";
const DEVICE_CAMERA_RESULT_STORAGE = "parkview.deviceCamera.latest";

function edgeApiUrl(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${EDGE_API_BASE_URL}${normalizedPath}`;
}

function cameraApiUrl(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (CAMERA_API_BASE_URL) return `${CAMERA_API_BASE_URL}${normalizedPath}`;
  const isLocalApp = !window.location.hostname.endsWith(".github.io") && !EDGE_API_BASE_URL;
  return isLocalApp ? normalizedPath : "";
}

async function loadRuntimeConfig() {
  const staticKey = String(
    window.PARKVIEW_CONFIG?.kakaoJavaScriptKey || ""
  ).trim();
  const staticConfig = {
    mapProvider: staticKey ? "kakao" : "fallback",
    kakaoJavaScriptKey: staticKey,
    kakaoConfigured: Boolean(staticKey),
    geminiConfigured: false,
    backendConnected: false
  };

  // GitHub Pages has no Python API. Its deployment workflow injects only the
  // public Kakao JavaScript key into config.js.
  if (!EDGE_API_BASE_URL && window.location.hostname.endsWith(".github.io")) {
    state.runtimeConfig = staticConfig;
    return state.runtimeConfig;
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(edgeApiUrl("/api/public-config"), {
      cache: "no-store",
      signal: controller.signal,
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
      backendConnected: true,
      mapProvider: kakaoJavaScriptKey ? "kakao" : "fallback",
      kakaoJavaScriptKey,
      kakaoConfigured: Boolean(kakaoJavaScriptKey)
    };
  } catch (error) {
    state.runtimeConfig = staticConfig;
    console.warn("Runtime configuration unavailable.", error);
  } finally {
    window.clearTimeout(timeout);
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
const LOCATION_PERMISSION_MESSAGE = "현재 위치는 거리 계산과 주변 주차장 검색에만 사용됩니다.";
const MICROPHONE_PERMISSION_MESSAGE = "마이크는 장소를 음성으로 검색할 때만 사용됩니다.";
const DEFAULT_PLAN_INSTRUCTION = "아크릴 주차장 사진을 보고 일반 주차면, 장애인 주차면, 임산부 주차면, 중앙 통로가 보이도록 깨끗한 2D 도면을 만들어줘.";
const FLOOR_PLAN_X_SCALE = 1.6;
let activeFloorPlanXScale = FLOOR_PLAN_X_SCALE;
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
  directCameraUrl: "",
  nativeCctvConnected: false,
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
  searchDestination: null,
  recommendationRanks: new Map(),
  filters: {
    openOnly: false,
    availableOnly: false,
    fee: "all",
    types: new Set(),
    favoritesOnly: false
  },
  searchFeedbackTimer: null,
  voiceRecognition: null,
  permissionKind: "location",
  locationPermissionState: "unknown",
  microphonePermissionGranted: false,
  lastLocationError: null,
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
  state.favoriteLotIds = loadFavoriteLotIds();
  state.directCameraUrl = loadDirectCameraLink();
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
  initializeLocationAccess();
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
    permissionOverlay: document.querySelector("#permissionOverlay"),
    permissionIcon: document.querySelector("#permissionIcon"),
    permissionTitle: document.querySelector("#permissionTitle"),
    permissionMessage: document.querySelector("#permissionMessage"),
    permissionPrimaryButton: document.querySelector("#permissionPrimaryButton"),
    permissionLaterButton: document.querySelector("#permissionLaterButton"),
    bottomSheet: document.querySelector("#bottomSheet"),
    sheetHandle: document.querySelector("#sheetHandle"),
    sheetTitle: document.querySelector("#sheetTitle"),
    listView: document.querySelector("#listView"),
    detailView: document.querySelector("#detailView"),
    lotList: document.querySelector("#lotList"),
    lotDetail: document.querySelector("#lotDetail"),
    backToList: document.querySelector("#backToList"),
    cameraStatus: document.querySelector("#cameraStatus"),
    cameraIntervalStatus: document.querySelector("#cameraIntervalStatus"),
    analysisStatus: document.querySelector("#analysisStatus"),
    objectStatus: document.querySelector("#objectStatus"),
    cameraSetupToggle: document.querySelector("#cameraSetupToggle"),
    cameraConnectionForm: document.querySelector("#cameraConnectionForm"),
    cameraRtspUrl: document.querySelector("#cameraRtspUrl"),
    cameraAdminTokenField: document.querySelector("#cameraAdminTokenField"),
    cameraAdminToken: document.querySelector("#cameraAdminToken"),
    cameraConnectButton: document.querySelector("#cameraConnectButton"),
    cameraOpenButton: document.querySelector("#cameraOpenButton"),
    cameraConnectFeedback: document.querySelector("#cameraConnectFeedback"),
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
  window.addEventListener("parkview:cctv-state", handleNativeCctvState);
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
  els.permissionPrimaryButton?.addEventListener("click", requestPermissionFromPanel);
  els.permissionLaterButton?.addEventListener("click", dismissPermissionPanel);
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
    if (!els.permissionOverlay.hidden) dismissPermissionPanel();
    else if (!els.searchSuggestions.hidden) hideSearchSuggestions();
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
  els.cameraSetupToggle?.addEventListener("click", toggleCameraConnectionForm);
  els.cameraConnectionForm?.addEventListener("submit", connectCameraFromAdmin);
  els.cameraOpenButton?.addEventListener("click", openDirectCameraLink);
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
    } else if (nativeBridge() && !els.permissionOverlay?.hidden) {
      void resumeNativePermissionFlow();
    } else if (els.managementView?.classList.contains("active")) {
      startEdgeStatusPolling();
    }
  });
  els.planImages?.addEventListener("change", handlePlanImageUpload);
  initializePlanControls();
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
  state.searchDestination = null;
  state.recommendationRanks.clear();
  clearSearchLocationMarker();
  hideSearchSuggestions();
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
  state.searchDestination = null;
  state.recommendationRanks.clear();
  clearSearchLocationMarker();
  hideSearchSuggestions();
  els.searchInput.value = "";
  state.mapSearchKeyword = "";
  state.filters = makeDefaultFilters();
  state.filters.favoritesOnly = true;
  syncFilterControls();
  showListView();
  applyCurrentFilters();
  setSearchFeedback(state.filteredLots.length ? "즐겨찾는 주차장만 표시합니다." : "아직 즐겨찾는 주차장이 없습니다.", !state.filteredLots.length);
}

function nativeBridge() {
  return window.ParkViewNative?.isNative ? window.ParkViewNative : null;
}

async function getCurrentCoordinates() {
  state.lastLocationError = null;
  const native = nativeBridge();
  if (native) {
    try {
      return await native.getCurrentPosition();
    } catch (error) {
      state.lastLocationError = {
        code: error?.name === "NotAllowedError" || error?.code === "PERMISSION_DENIED" ? 1 : 2,
        message: error?.message || "현재 위치를 확인하지 못했습니다.",
        nativeCode: error?.code || ""
      };
      return null;
    }
  }
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      (error) => {
        state.lastLocationError = error;
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 }
    );
  });
}

function showPermissionPanel(kind, options = {}) {
  if (!els.permissionOverlay) return;
  const isMicrophone = kind === "microphone";
  state.permissionKind = kind;
  els.permissionTitle.textContent = isMicrophone
    ? "음성으로 장소를 검색할까요?"
    : "내 주변 주차장을 찾을까요?";
  els.permissionMessage.textContent = options.message || (isMicrophone
    ? MICROPHONE_PERMISSION_MESSAGE
    : LOCATION_PERMISSION_MESSAGE);
  els.permissionPrimaryButton.textContent = options.actionLabel || (isMicrophone
    ? "마이크 활성화"
    : "현재 위치 활성화");
  els.permissionPrimaryButton.disabled = false;
  els.permissionIcon.innerHTML = `<i data-lucide="${isMicrophone ? "mic" : "locate-fixed"}"></i>`;
  els.permissionOverlay.hidden = false;
  els.permissionOverlay.setAttribute("aria-hidden", "false");
  refreshIcons();
}

function hidePermissionPanel() {
  if (!els.permissionOverlay) return;
  els.permissionOverlay.hidden = true;
  els.permissionOverlay.setAttribute("aria-hidden", "true");
}

function dismissPermissionPanel() {
  hidePermissionPanel();
}

function locationPermissionIsBlocked() {
  return window.isSecureContext === false || state.lastLocationError?.code === 1;
}

function locationFailureMessage() {
  if (window.isSecureContext === false) {
    return "현재 위치는 HTTPS 보안 주소에서만 사용할 수 있습니다. 배포된 ParkView 주소로 접속해 주세요.";
  }
  if (state.lastLocationError?.code === 1) {
    return "현재 위치 요청이 허용되지 않았습니다. 활성화 버튼을 눌러 다시 요청해 주세요.";
  }
  if (state.lastLocationError?.code === 2) {
    return "기기의 위치 서비스를 확인할 수 없습니다. 위치 서비스를 켠 뒤 다시 시도해 주세요.";
  }
  if (state.lastLocationError?.code === 3) {
    return "현재 위치 확인 시간이 초과됐습니다. GPS 수신이 잘 되는 곳에서 다시 시도해 주세요.";
  }
  return "현재 위치를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

async function initializeLocationAccess() {
  const native = nativeBridge();
  if (native) {
    let permissionState = "prompt";
    try {
      permissionState = await native.checkLocationPermission();
    } catch (error) {
      console.info("Native location permission state is unavailable.", error);
    }
    state.locationPermissionState = permissionState;
    const denied = permissionState === "denied";
    showPermissionPanel("location", permissionState === "granted" ? {
      message: "현재 위치 권한이 활성화되어 있습니다.",
      actionLabel: "현재 위치로 이동"
    } : denied ? {
      blocked: true,
      message: "위치 권한이 차단되어 있습니다. 버튼을 누르면 ParkView 앱 설정이 열립니다.",
      actionLabel: "앱 설정 열기"
    } : {
      message: "버튼을 누르면 휴대폰의 위치 권한을 요청하고 현재 위치로 이동합니다."
    });
    return;
  }
  if (!navigator.geolocation) {
    setSearchFeedback("이 기기에서는 현재 위치를 확인할 수 없습니다.", true);
    return;
  }

  let permissionState = "prompt";
  try {
    if (navigator.permissions?.query) {
      const permission = await navigator.permissions.query({ name: "geolocation" });
      permissionState = permission.state;
      state.locationPermissionState = permissionState;
      permission.addEventListener?.("change", () => {
        state.locationPermissionState = permission.state;
        if (permission.state === "granted" && !els.permissionOverlay.hidden) {
          showPermissionPanel("location", {
            message: "위치 권한이 허용되어 있습니다. 버튼을 눌러 현재 위치로 이동하세요.",
            actionLabel: "현재 위치로 이동"
          });
        }
      });
    }
  } catch (error) {
    console.info("Geolocation permission state is unavailable.", error);
  }

  if (permissionState === "denied") {
    showPermissionPanel("location", {
      blocked: true,
      message: "현재 위치 활성화 버튼을 누르면 브라우저에 위치 권한을 요청합니다."
    });
  } else if (permissionState === "granted") {
    showPermissionPanel("location", {
      message: "위치 권한이 허용되어 있습니다. 버튼을 눌러 현재 위치로 이동하세요.",
      actionLabel: "현재 위치로 이동"
    });
  } else {
    showPermissionPanel("location");
  }
}

async function refreshLocationPermissionState() {
  const native = nativeBridge();
  if (native) {
    try {
      state.locationPermissionState = await native.checkLocationPermission();
    } catch (_error) {
      state.locationPermissionState = "unknown";
    }
    return state.locationPermissionState;
  }
  try {
    if (navigator.permissions?.query) {
      state.locationPermissionState = (await navigator.permissions.query({ name: "geolocation" })).state;
    }
  } catch (_error) {
    state.locationPermissionState = "unknown";
  }
  return state.locationPermissionState;
}

async function resumeNativePermissionFlow() {
  const native = nativeBridge();
  if (!native || els.permissionOverlay?.hidden) return;
  try {
    if (state.permissionKind === "microphone") {
      const permission = await native.checkSpeechPermission();
      if (permission === "granted") {
        state.microphonePermissionGranted = true;
        hidePermissionPanel();
        await startNativeVoiceSearch();
      }
      return;
    }
    const permission = await native.checkLocationPermission();
    state.locationPermissionState = permission;
    if (permission === "granted") await requestLocationFromPermissionPanel();
  } catch (error) {
    console.info("Native permission state could not be refreshed.", error);
  }
}

async function showLocationRequestFailure() {
  await refreshLocationPermissionState();
  const blocked = locationPermissionIsBlocked();
  const nativeDenied = Boolean(nativeBridge() && state.locationPermissionState === "denied");
  const message = nativeDenied
    ? "위치 권한이 차단되어 있습니다. 버튼을 누르면 ParkView 앱 설정이 열립니다."
    : blocked && state.locationPermissionState === "granted"
    ? "현재 위치를 가져오지 못했습니다. 활성화 버튼을 눌러 다시 요청해 주세요."
    : locationFailureMessage();
  setSearchFeedback(message, true, 5000);
  showPermissionPanel("location", {
    blocked,
    message,
    actionLabel: nativeDenied ? "앱 설정 열기" : blocked ? "현재 위치 활성화" : "다시 시도"
  });
}

function requestPermissionFromPanel() {
  if (state.permissionKind === "microphone") return requestMicrophonePermissionFromPanel();
  return requestLocationFromPermissionPanel();
}

async function requestLocationFromPermissionPanel() {
  if (!nativeBridge() && !navigator.geolocation) {
    els.permissionMessage.textContent = "이 기기에서는 현재 위치를 확인할 수 없습니다.";
    return;
  }

  const button = els.permissionPrimaryButton;
  const native = nativeBridge();
  if (native) {
    const permission = await native.checkLocationPermission().catch(() => "unknown");
    if (permission === "denied") {
      button.disabled = true;
      button.textContent = "앱 설정 여는 중...";
      try {
        await native.openAppSettings();
      } catch (error) {
        setSearchFeedback(error?.message || "앱 설정을 열지 못했습니다.", true, 5000);
      } finally {
        button.disabled = false;
        button.textContent = "앱 설정 열기";
      }
      return;
    }
  }
  button.disabled = true;
  button.textContent = "위치 확인 중...";
  setLocateLoading(true);
  const location = await getCurrentCoordinates();
  setLocateLoading(false);

  if (!location) {
    await showLocationRequestFailure();
    return;
  }

  hidePermissionPanel();
  applyUserLocation(location, true);
  setSearchFeedback("현재 위치 주변 주차장으로 이동했습니다.");
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
  if (!nativeBridge() && !navigator.geolocation) {
    setSearchFeedback("이 기기에서는 현재 위치를 확인할 수 없습니다.", true);
    return;
  }
  const native = nativeBridge();
  if (native && await native.checkLocationPermission().catch(() => "unknown") === "denied") {
    showPermissionPanel("location", {
      blocked: true,
      message: "위치 권한이 차단되어 있습니다. 버튼을 누르면 ParkView 앱 설정이 열립니다.",
      actionLabel: "앱 설정 열기"
    });
    try {
      await native.openAppSettings();
    } catch (error) {
      setSearchFeedback(error?.message || "앱 설정을 열지 못했습니다.", true, 5000);
    }
    return;
  }
  setLocateLoading(true);
  setSearchFeedback("현재 위치를 확인하고 있습니다.", false, 9000);
  const location = await getCurrentCoordinates();
  setLocateLoading(false);
  if (!location) {
    await showLocationRequestFailure();
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

async function startVoiceSearch() {
  if (nativeBridge()) {
    await startNativeVoiceSearch();
    return;
  }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    els.searchInput.focus();
    setSearchFeedback("이 브라우저에서는 음성 검색을 지원하지 않습니다.", true);
    return;
  }
  await activateMicrophoneAndStart();
}

async function requestMicrophonePermissionFromPanel() {
  if (nativeBridge()) {
    await startNativeVoiceSearch(true);
    return;
  }
  await activateMicrophoneAndStart(true);
}

async function startNativeVoiceSearch(fromPanel = false) {
  const native = nativeBridge();
  if (!native) return;
  const permission = await native.checkSpeechPermission().catch(() => "unknown");
  if (permission === "denied") {
    showPermissionPanel("microphone", {
      blocked: true,
      message: "마이크 또는 음성 인식 권한이 차단되어 있습니다. 버튼을 누르면 ParkView 앱 설정이 열립니다.",
      actionLabel: "앱 설정 열기"
    });
    try {
      await native.openAppSettings();
    } catch (error) {
      setSearchFeedback(error?.message || "앱 설정을 열지 못했습니다.", true, 5000);
    }
    return;
  }
  const button = fromPanel ? els.permissionPrimaryButton : null;
  if (button) {
    button.disabled = true;
    button.textContent = "음성 인식 시작 중...";
  }
  els.voiceSearchButton.classList.add("is-listening");
  els.voiceSearchButton.setAttribute("aria-pressed", "true");
  setSearchFeedback("검색할 장소를 말씀해 주세요.", false, 20000);
  try {
    const transcript = await native.recognizeSpeech();
    state.microphonePermissionGranted = true;
    hidePermissionPanel();
    if (!transcript) {
      setSearchFeedback("음성을 인식하지 못했습니다. 다시 눌러 말씀해 주세요.", true, 5000);
      return;
    }
    els.searchInput.value = transcript;
    handleSearchInput();
    await searchMapLocation();
  } catch (error) {
    const blocked = error?.name === "NotAllowedError" || error?.code === "PERMISSION_DENIED";
    state.microphonePermissionGranted = !blocked;
    if (blocked) {
      showPermissionPanel("microphone", {
        blocked: true,
        message: "마이크 또는 음성 인식 권한이 차단되어 있습니다. 버튼을 누르면 ParkView 앱 설정이 열립니다.",
        actionLabel: "앱 설정 열기"
      });
      return;
    }
    setSearchFeedback(error?.message || "음성 검색을 시작하지 못했습니다.", true, 6000);
  } finally {
    els.voiceSearchButton.classList.remove("is-listening");
    els.voiceSearchButton.setAttribute("aria-pressed", "false");
    if (button) {
      button.disabled = false;
      button.textContent = "음성 검색 활성화";
    }
  }
}

async function activateMicrophoneAndStart(fromPanel = false) {
  if (!navigator.mediaDevices?.getUserMedia) {
    hidePermissionPanel();
    setSearchFeedback("이 브라우저에서는 마이크 권한을 요청할 수 없습니다.", true, 5000);
    return;
  }

  const button = fromPanel ? els.permissionPrimaryButton : null;
  if (button) {
    button.disabled = true;
    button.textContent = "마이크 활성화 중...";
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    state.microphonePermissionGranted = true;
    hidePermissionPanel();
    beginVoiceRecognition();
  } catch (error) {
    const blocked = error?.name === "NotAllowedError" || error?.name === "SecurityError";
    showPermissionPanel("microphone", {
      blocked,
      message: blocked
        ? "마이크 요청이 허용되지 않았습니다. 활성화 버튼을 눌러 다시 요청해 주세요."
        : "마이크를 사용할 수 없습니다. 다른 앱에서 마이크를 사용 중인지 확인해 주세요.",
      actionLabel: blocked ? "마이크 활성화" : "다시 시도"
    });
  }
}

function beginVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;
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
  recognition.onerror = (event) => {
    if (event.error === "service-not-allowed") {
      setSearchFeedback("마이크 권한은 활성화됐지만 이 브라우저가 음성 인식 서비스를 지원하지 않습니다.", true, 6000);
      return;
    }
    if (event.error === "not-allowed") {
      state.microphonePermissionGranted = false;
      showPermissionPanel("microphone", {
        blocked: true,
        message: "마이크 요청이 허용되지 않았습니다. 활성화 버튼을 눌러 다시 요청해 주세요."
      });
      return;
    }
    setSearchFeedback("음성을 인식하지 못했습니다. 다시 시도해 주세요.", true);
  };
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
  const keyword = state.searchDestination ? "" : els.searchInput.value.trim();
  state.mapSearchKeyword = keyword.toLowerCase();
  const filtered = filterLotCollection(state.lots, keyword);
  state.filteredLots = state.searchDestination
    ? rankDestinationParkingLots(filtered)
    : filtered;
  updateQuickFilterButtons();
  updateSheetTitle();
  renderMapMarkers();
  renderList();
}

function updateSheetTitle() {
  if (!els.sheetTitle) return;
  if (state.filters.favoritesOnly) els.sheetTitle.textContent = "즐겨찾기";
  else if (state.searchDestination) els.sheetTitle.textContent = `${state.searchDestination.name} 주변 추천`;
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
      rowIndex: Number.isInteger(slot.rowIndex) ? slot.rowIndex : null,
      rowPosition: Number.isInteger(slot.rowPosition) ? slot.rowPosition : null,
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
    aspectRatio: normalizeFloorAspectRatio(floor?.aspectRatio),
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
  if (view !== "management") {
    window.dispatchEvent(new Event("parkview:stop-device-camera"));
  }
  state.adminView = view;
  els.adminScreen.dataset.view = view;
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
  state.planGenerated = false;
  document.querySelector("#planAutoCount").checked = true;
  els.registerTotalSpaces.disabled = true;
  updateRequestedFloors();
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
  els.geminiStatus.textContent = "";
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
    panel.scrollTop = 0;
  });
  els.registrationStepCount.textContent = `${state.registrationStep + 1} / ${REGISTRATION_STEPS.length}`;
  els.registrationStepTitle.textContent = step.title;
  els.registrationProgressBar.style.width = `${((state.registrationStep + 1) / REGISTRATION_STEPS.length) * 100}%`;
  els.registrationBackButton.disabled = state.registrationStep === 0;
  els.registrationNextButton.textContent = step.next;
  els.registrationNextButton.hidden = step.id === "plan";
  els.registrationNextButton.parentElement.classList.toggle("plan-step", step.id === "plan");

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
  if (step === "plan" && !state.planGenerated) {
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
    aspectRatio: normalizeFloorAspectRatio(floor.aspectRatio),
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
  // Kakao Web supports touch pan and pinch zoom, but exposes no bearing or tilt API.
  state.mainMap = new window.kakao.maps.Map(els.realMap, {
    center: new window.kakao.maps.LatLng(initialLatitude, initialLongitude),
    level: kakaoLevelFromZoom(initialZoom),
    draggable: true,
    scrollwheel: true,
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
  const source = state.searchDestination || state.mapSearchKeyword || hasActiveLotFilters()
    ? state.filteredLots
    : state.lots;
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

function parkingSearchRequested(query) {
  return /주차|파킹|parking/i.test(String(query || ""));
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
  const options = {
    size: 10,
    sort: window.kakao.maps.services.SortBy.ACCURACY
  };
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
    categoryGroupCode: place.category_group_code,
    latitude: Number(place.y),
    longitude: Number(place.x),
    distanceMeters: optionalNumber(place.distance),
    source: "kakao-place",
    placeUrl: place.place_url
  })).filter((place) => Number.isFinite(place.latitude) && Number.isFinite(place.longitude));
}

function mergeSearchSuggestions(primary, secondary) {
  const merged = [...primary];
  secondary.forEach((candidate) => {
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

  const local = parkingSearchRequested(query) ? localSearchSuggestions(query) : [];
  state.searchSuggestions = local;
  renderSearchSuggestions();
  if (query.length < 2) return;

  const token = state.searchSuggestionToken;
  state.searchSuggestionTimer = window.setTimeout(async () => {
    try {
      const remote = await kakaoKeywordSuggestions(query);
      if (token !== state.searchSuggestionToken || query !== els.searchInput.value.trim()) return;
      state.searchSuggestions = mergeSearchSuggestions(remote, local);
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
  state.searchDestination = {
    name: suggestion.name,
    latitude: suggestion.latitude,
    longitude: suggestion.longitude
  };
  state.mapSearchKeyword = "";
  state.filteredLots = rankDestinationParkingLots(filterLotCollection(state.lots, ""));
  updateSheetTitle();
  showListView();
  updateSearchLocationMarker(suggestion);
  focusMapOn(suggestion.latitude, suggestion.longitude, 16);
  renderMapMarkers();
  renderList();
  window.setTimeout(refreshNearbyList, 320);
  setSearchFeedback(`${suggestion.name} 주변의 저렴하고 가까운 주차장을 추천합니다.`);
}

async function searchMapLocation() {
  const query = els.searchInput.value.trim();
  if (!query) {
    resetMapSearch();
    return;
  }
  setSearchFeedback("장소를 검색하고 있습니다.", false, 6000);
  try {
    const local = parkingSearchRequested(query) ? localSearchSuggestions(query) : [];
    let remote = [];
    try {
      remote = await kakaoKeywordSuggestions(query);
    } catch (error) {
      console.warn("[ParkView] keyword search unavailable; trying address search", error);
    }
    const suggestion = mergeSearchSuggestions(remote, local)[0];
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
  state.searchDestination = null;
  state.recommendationRanks.clear();
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
  if (state.searchDestination) {
    state.filteredLots = rankDestinationParkingLots(filterLotCollection(state.lots, ""));
    updateSheetTitle();
    if (hasActiveLotFilters()) renderMapMarkers();
    renderList();
    return;
  }
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

function destinationDistanceMeters(lot) {
  if (!state.searchDestination) return null;
  return haversineKm(
    state.searchDestination.latitude,
    state.searchDestination.longitude,
    lot.latitude,
    lot.longitude
  ) * 1000;
}

function destinationRecommendationScore(lot, distanceMeters) {
  const distanceScore = clamp(distanceMeters / 1500, 0, 1);
  const priceScore = Number.isFinite(lot.hourlyPrice)
    ? clamp(lot.hourlyPrice / 6000, 0, 1)
    : 0.72;
  const capacityScore = Number.isFinite(lot.totalSpaces)
    ? 1 - clamp(lot.totalSpaces / 200, 0, 1)
    : 0.5;
  const operationScore = lot.isOpen ? 0 : 1;
  const fullPenalty = hasLiveAvailability(lot) && lot.availableSpaces < 1 ? 0.8 : 0;
  return distanceScore * 0.5 + priceScore * 0.34 + operationScore * 0.1 + capacityScore * 0.06 + fullPenalty;
}

function rankDestinationParkingLots(lots) {
  state.recommendationRanks.clear();
  if (!state.searchDestination) return lots;
  const scored = lots.map((lot) => {
    const distanceMeters = destinationDistanceMeters(lot);
    return {
      lot,
      distanceMeters,
      score: destinationRecommendationScore(lot, distanceMeters)
    };
  });
  const withinThreeKm = scored.filter(({ distanceMeters }) => distanceMeters <= 3000);
  const candidates = withinThreeKm.length >= 5
    ? withinThreeKm
    : [...scored].sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 50);
  const ranked = candidates
    .sort((a, b) => a.score - b.score || a.distanceMeters - b.distanceMeters)
    .slice(0, 200);
  ranked.forEach(({ lot }, index) => state.recommendationRanks.set(String(lot.id), index + 1));
  return ranked.map(({ lot }) => lot);
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
    : state.searchDestination
      ? "목적지 주변에 등록된 주차장이 없습니다."
      : "조건에 맞는 주차장이 없습니다.";
  els.lotList.replaceChildren(empty);
}

function lotCard(lot) {
  const recommendationRank = state.recommendationRanks.get(String(lot.id));
  const destinationDistance = destinationDistanceMeters(lot);
  const distanceText = state.searchDestination
    ? `${formatLotDistance(lot)} · 목적지 ${formatDistance(destinationDistance)}`
    : formatLotDistance(lot);
  const button = document.createElement("button");
  button.className = `lot-card${recommendationRank && recommendationRank <= 3 ? " is-recommended" : ""}`;
  button.innerHTML = `
    <span class="lot-main">
      <span class="lot-title-row">
        ${recommendationRank && recommendationRank <= 3 ? `<em class="recommendation-badge">추천 ${recommendationRank}</em>` : ""}
        <h2>${escapeHtml(lot.name)}</h2>
      </span>
      <p>${escapeHtml(distanceText)}</p>
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
  els.lotDetail.scrollTop = 0;
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
        <button id="detailShare" class="detail-action" type="button"><span class="detail-action-icon"><i data-lucide="share-2"></i></span><span>공유</span></button>
        <button id="detailFavorite" class="detail-action${isFavorite ? " is-active" : ""}" type="button" aria-pressed="${isFavorite}"><span class="detail-action-icon"><i data-lucide="star"></i></span><span>즐겨찾기</span></button>
        <button id="detailNavigate" class="detail-action primary" type="button"><span class="detail-action-icon"><i data-lucide="navigation"></i></span><span>길찾기</span></button>
      </div>
      <p id="detailFeedback" class="detail-feedback" role="status"></p>
    </header>

    <section class="parking-info-panel" aria-label="주차장 이용 정보">
      <div class="parking-info-row"><span>주차요금</span><strong>${escapeHtml(feeLabel)}</strong></div>
      <div class="parking-info-row"><span>운영시간</span><strong>${escapeHtml(operatingHours)}</strong></div>
      ${hasRealtime ? '<button id="detailVacancyButton" class="detail-vacancy-button" type="button">실시간 빈자리 확인</button>' : ""}
    </section>

    <section class="detail-contact-list" aria-label="주차장 연락처와 주소">
      <div class="detail-contact-row"><i data-lucide="map-pin"></i><span>${escapeHtml(lot.address || "주소 정보 없음")}</span></div>
      <div class="detail-contact-row"><i data-lucide="phone"></i>${lot.phone
        ? `<a href="tel:${escapeHtml(lot.phone.replace(/[^0-9+]/g, ""))}">${escapeHtml(lot.phone)}</a>`
        : "<span class=\"muted-contact\">전화번호 정보 없음</span>"}</div>
    </section>

    <section id="detailVacancySection" class="detail-content-section">
      <p class="detail-section-label">${hasRealtime ? "실시간 주차 현황" : "주차면 정보"}</p>
      <div class="vacancy-card${!hasTotalSpaces && !hasRealtime ? " is-unavailable" : ""}">
        <span>${hasRealtime
          ? "현재 이용 가능한 자리 <em>LIVE</em>"
          : hasTotalSpaces ? "전체 주차면 · 실시간 잔여 미제공" : "전체 주차면"}</span>
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
  refreshIcons();
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
  button?.setAttribute("aria-pressed", String(active));
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
  const sourceFloor = Array.isArray(floorOrSlots)
    ? { slots: floorOrSlots, elements: [], outline: [], zones: [] }
    : floorOrSlots || { slots: [], elements: [], outline: [], zones: [] };
  activeFloorPlanXScale = normalizeFloorAspectRatio(sourceFloor.aspectRatio);
  container.style.setProperty("--floor-plan-aspect", String(activeFloorPlanXScale));
  const sourceSlots = Array.isArray(sourceFloor.slots) ? sourceFloor.slots : [];
  const floor = fitFloorToDrawingBounds(sourceFloor);
  const slots = Array.isArray(floor.slots) ? floor.slots : [];
  const elements = Array.isArray(floor.elements) ? floor.elements : [];
  const zones = Array.isArray(floor.zones) ? floor.zones : [];
  const outline = simplifyFloorOutline(resolveFloorOutline(floor, slots, elements));
  const displaySlots = standardizeFloorPlanSlots(slots, outline);
  const drawableElements = prepareDrawableFloorElements(elements, displaySlots, outline);
  const hasPlan = slots.length > 0 || elements.length > 0 || zones.length > 0;

  container.replaceChildren();
  container.classList.toggle("has-plan", hasPlan);
  if (!hasPlan) return;

  const svgId = `floor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const svg = createSvgElement("svg", {
    class: "floor-plan-svg",
    viewBox: floorPlanViewBox(outline),
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
    "aria-label": `${floor.name || "주차장"} 건축 평면도`
  });
  const defs = createSvgElement("defs");
  const stripePattern = createSvgElement("pattern", {
    id: `${svgId}-stripe`, width: 5, height: 5, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)"
  });
  stripePattern.appendChild(createSvgElement("rect", { width: 2.2, height: 5, class: "floor-stripe-fill" }));
  defs.append(stripePattern);
  svg.appendChild(defs);
  svg.appendChild(createSvgElement("rect", {
    x: -20, y: -20, width: 200, height: 140, class: "floor-canvas"
  }));

  const footprint = createSvgElement("polygon", {
    points: svgPoints(outline),
    class: "floor-footprint"
  });
  svg.appendChild(footprint);

  const backgroundTypes = new Set();
  drawableElements.filter((element) => backgroundTypes.has(element.type)).forEach((element) => {
    renderSvgPlanElement(svg, element, `${svgId}-stripe`);
  });

  displaySlots.forEach((slot, index) => {
    const sourceSlot = sourceSlots[index];
    const orientation = slot.w >= slot.h ? "horizontal" : "vertical";
    const group = createSvgElement("g", {
      class: `floor-slot floor-slot-${slot.kind} floor-slot-${slot.status} ${orientation}`,
      role: editable ? "button" : "img",
      tabindex: editable ? "0" : "-1",
      "aria-label": `${index + 1}번 주차면 ${slot.status === "available" ? "주차 가능" : "주차 중"}`
    });
    const x = toSvgX(slot.x);
    const y = slot.y;
    const width = toSvgX(slot.w);
    const height = slot.h;
    const rotation = clamp(Number(slot.rotation) || 0, -180, 180);
    if (Math.abs(rotation) > 0.1) {
      group.setAttribute("transform", `rotate(${rotation} ${x + width / 2} ${y + height / 2})`);
    }
    group.appendChild(createSvgElement("rect", { x, y, width, height, class: "floor-slot-body" }));
    if (editable) {
      const toggle = () => {
        sourceSlot.status = sourceSlot.status === "available" ? "occupied" : "available";
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
  appendFloorOutline(svg, outline, drawableElements);
  container.appendChild(svg);
}

function floorPlanViewBox(outline) {
  const xs = outline.map((point) => toSvgX(point.x));
  const ys = outline.map((point) => point.y);
  const minX = Math.min(...xs) - 4;
  const maxX = Math.max(...xs) + 4;
  const minY = Math.min(...ys) - 4;
  const maxY = Math.max(...ys) + 4;
  return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
}

function standardizeFloorPlanSlots(slots, outline) {
  if (!slots.length) return [];
  const centers = slots.map((slot) => ({
    x: toSvgX(Number(slot.x) + Number(slot.w) / 2),
    y: Number(slot.y) + Number(slot.h) / 2
  }));
  const rowDistances = floorSlotRowDistances(slots, centers).sort((a, b) => a - b);
  const middle = Math.floor(rowDistances.length / 2);
  const medianSpacing = rowDistances.length
    ? (rowDistances.length % 2 ? rowDistances[middle] : (rowDistances[middle - 1] + rowDistances[middle]) / 2)
    : 11;
  const shortSide = clamp(medianSpacing * 0.9, 6.5, 22);
  const longSide = shortSide * 1.9;
  const rawWidth = shortSide / activeFloorPlanXScale;

  const outlineSvg = outline.map((point) => ({ x: toSvgX(point.x), y: point.y }));
  const standardized = slots.map((slot, index) => ({
    ...slot,
    x: centers[index].x / activeFloorPlanXScale - rawWidth / 2,
    y: centers[index].y - longSide / 2,
    w: rawWidth,
    h: longSide
  }));
  groupDisplaySlotsByRow(standardized).forEach((indexes) => {
    normalizeDisplaySlotSpacing(indexes, standardized);
    alignDisplaySlotRow(indexes, standardized);
    shiftDisplaySlotRowInsideOutline(indexes, standardized, outlineSvg);
  });
  return standardized;
}

function normalizeDisplaySlotSpacing(indexes, slots) {
  if (indexes.length < 3) return;
  const angle = Number(slots[indexes[0]].rotation) || 0;
  const radians = angle * Math.PI / 180;
  const axis = { x: Math.cos(radians), y: Math.sin(radians) };
  const ordered = indexes.map((index) => ({
    index,
    position: toSvgX(slots[index].x + slots[index].w / 2) * axis.x
      + (slots[index].y + slots[index].h / 2) * axis.y
  })).sort((a, b) => a.position - b.position);
  const gaps = ordered.slice(1)
    .map((item, index) => item.position - ordered[index].position)
    .filter((gap) => gap > 2.5 && gap < 55)
    .sort((a, b) => a - b);
  if (!gaps.length) return;
  const middle = Math.floor(gaps.length / 2);
  const typicalGap = gaps.length % 2
    ? gaps[middle]
    : (gaps[middle - 1] + gaps[middle]) / 2;
  let targetPosition = ordered[0].position;
  ordered.slice(1).forEach((item, offset) => {
    const rawGap = item.position - ordered[offset].position;
    const desiredGap = rawGap < typicalGap * 1.45 ? typicalGap : rawGap;
    targetPosition += desiredGap;
    const shift = targetPosition - item.position;
    slots[item.index].x += axis.x * shift / activeFloorPlanXScale;
    slots[item.index].y += axis.y * shift;
  });
}

function floorSlotRowDistances(slots, centers) {
  return groupDisplaySlotsByRow(slots).flatMap((indexes) => {
    if (indexes.length < 2) return [];
    const angle = Number(slots[indexes[0]].rotation) || 0;
    const radians = angle * Math.PI / 180;
    const axis = { x: Math.cos(radians), y: Math.sin(radians) };
    const ordered = indexes.map((index) => ({
      index,
      position: centers[index].x * axis.x + centers[index].y * axis.y
    })).sort((a, b) => a.position - b.position);
    return ordered.slice(1).map((item, index) => {
      const current = centers[item.index];
      const previous = centers[ordered[index].index];
      return Math.hypot(current.x - previous.x, current.y - previous.y);
    }).filter((distance) => distance > 2.5 && distance < 55);
  });
}

function alignDisplaySlotRow(indexes, slots) {
  if (indexes.length < 2) return;
  const sourceAngle = Number(slots[indexes[0]].rotation) || 0;
  const sourceRadians = sourceAngle * Math.PI / 180;
  const sourceAxis = { x: Math.cos(sourceRadians), y: Math.sin(sourceRadians) };
  const ordered = [...indexes].sort((a, b) => {
    const aPosition = toSvgX(slots[a].x + slots[a].w / 2) * sourceAxis.x
      + (slots[a].y + slots[a].h / 2) * sourceAxis.y;
    const bPosition = toSvgX(slots[b].x + slots[b].w / 2) * sourceAxis.x
      + (slots[b].y + slots[b].h / 2) * sourceAxis.y;
    return aPosition - bPosition;
  });
  const first = slots[ordered[0]];
  const last = slots[ordered[ordered.length - 1]];
  const deltaX = toSvgX(last.x + last.w / 2) - toSvgX(first.x + first.w / 2);
  const deltaY = last.y + last.h / 2 - (first.y + first.h / 2);
  if (Math.hypot(deltaX, deltaY) < 1) return;
  const rowAngle = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
  indexes.forEach((index) => {
    slots[index].rotation = rowAngle;
  });
}

function groupDisplaySlotsByRow(slots) {
  const groups = [];
  slots.forEach((slot, index) => {
    const center = { x: toSvgX(slot.x + slot.w / 2), y: slot.y + slot.h / 2 };
    const angle = ((Number(slot.rotation) || 0) % 180 + 180) % 180;
    const radians = angle * Math.PI / 180;
    const normal = { x: -Math.sin(radians), y: Math.cos(radians) };
    let group = groups.find((candidate) => {
      const angleDifference = Math.abs(candidate.angle - angle);
      const wrappedDifference = Math.min(angleDifference, 180 - angleDifference);
      const deltaX = center.x - candidate.anchor.x;
      const deltaY = center.y - candidate.anchor.y;
      return wrappedDifference < 8
        && Math.abs(deltaX * candidate.normal.x + deltaY * candidate.normal.y) < 5.5;
    });
    if (!group) {
      group = {
        angle,
        normal,
        anchor: center,
        indexes: []
      };
      groups.push(group);
    }
    group.indexes.push(index);
    const count = group.indexes.length;
    group.anchor = {
      x: group.anchor.x + (center.x - group.anchor.x) / count,
      y: group.anchor.y + (center.y - group.anchor.y) / count
    };
  });
  return groups.map((group) => group.indexes);
}

function shiftDisplaySlotRowInsideOutline(indexes, slots, outline) {
  if (outline.length < 3 || !indexes.length) return;
  const polygonCenterPoint = {
    x: outline.reduce((sum, point) => sum + point.x, 0) / outline.length,
    y: outline.reduce((sum, point) => sum + point.y, 0) / outline.length
  };
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const corners = indexes.flatMap((index) => {
      const slot = slots[index];
      return rotatedSlotCorners(
        toSvgX(slot.x + slot.w / 2),
        slot.y + slot.h / 2,
        toSvgX(slot.w),
        slot.h,
        slot.rotation
      );
    });
    if (corners.every((corner) => pointInsideFloorPolygon(corner, outline))) return;
    const rowCenter = indexes.reduce((center, index) => ({
      x: center.x + toSvgX(slots[index].x + slots[index].w / 2) / indexes.length,
      y: center.y + (slots[index].y + slots[index].h / 2) / indexes.length
    }), { x: 0, y: 0 });
    const shiftX = (polygonCenterPoint.x - rowCenter.x) * 0.08;
    const shiftY = (polygonCenterPoint.y - rowCenter.y) * 0.08;
    indexes.forEach((index) => {
      slots[index].x += shiftX / activeFloorPlanXScale;
      slots[index].y += shiftY;
    });
  }
}

function rotatedSlotCorners(centerX, centerY, width, height, rotation = 0) {
  const radians = Number(rotation) * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [
    [-width / 2, -height / 2],
    [width / 2, -height / 2],
    [width / 2, height / 2],
    [-width / 2, height / 2]
  ].map(([x, y]) => ({
    x: centerX + x * cosine - y * sine,
    y: centerY + x * sine + y * cosine
  }));
}

function pointInsideFloorPolygon(point, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const a = polygon[current];
    const b = polygon[previous];
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function prepareDrawableFloorElements(elements, slots, outline = []) {
  const accepted = [];
  [...elements]
    .filter((element) => element && ["entrance", "exit"].includes(element.type))
    .sort((a, b) => b.confidence - a.confidence)
    .forEach((element) => {
      if (element.confidence < 0.9) return;
      if (accepted.some((candidate) => candidate.type === element.type)) return;
      if (floorElementOverlapsSlots(element, slots, 1.2)) return;
      if (floorElementDistanceFromOutline(element, outline) > 4) return;
      const center = { x: toSvgX(element.x + element.w / 2), y: element.y + element.h / 2 };
      if (accepted.some((candidate) => {
        const candidateCenter = {
          x: toSvgX(candidate.x + candidate.w / 2),
          y: candidate.y + candidate.h / 2
        };
        return Math.hypot(center.x - candidateCenter.x, center.y - candidateCenter.y) < 8;
      })) return;
      accepted.push(element);
    });
  return accepted;
}

function floorElementDistanceFromOutline(element, outline) {
  if (outline.length < 3) return Number.POSITIVE_INFINITY;
  const center = { x: toSvgX(element.x + element.w / 2), y: element.y + element.h / 2 };
  return outline.reduce((nearest, point, index) => {
    const start = { x: toSvgX(point.x), y: point.y };
    const next = outline[(index + 1) % outline.length];
    const end = { x: toSvgX(next.x), y: next.y };
    return Math.min(nearest, projectPointToSegment(center, start, end).distance);
  }, Number.POSITIVE_INFINITY);
}

function floorElementOverlapsSlots(element, slots, padding = 0) {
  const elementX = toSvgX(element.x);
  const elementY = element.y;
  const elementWidth = toSvgX(element.w);
  const elementHeight = element.h;
  return slots.some((slot) => {
    const slotX = toSvgX(slot.x);
    const slotY = slot.y;
    const slotWidth = toSvgX(slot.w);
    const slotHeight = slot.h;
    return elementX < slotX + slotWidth + padding
      && elementX + elementWidth + padding > slotX
      && elementY < slotY + slotHeight + padding
      && elementY + elementHeight + padding > slotY;
  });
}

function createSvgElement(name, attributes = {}, text = "") {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  if (text) element.textContent = text;
  return element;
}

function toSvgX(value) {
  return Number(value) * activeFloorPlanXScale;
}

function normalizeFloorAspectRatio(value) {
  return clamp(Number(value) || FLOOR_PLAN_X_SCALE, 1, 3.2);
}

function fitFloorToDrawingBounds(floor) {
  const outline = normalizeFloorPoints(floor.outline, 3);
  if (outline.length < 3) return floor;
  const minX = Math.min(...outline.map((point) => point.x));
  const maxX = Math.max(...outline.map((point) => point.x));
  const minY = Math.min(...outline.map((point) => point.y));
  const maxY = Math.max(...outline.map((point) => point.y));
  const sourceWidth = maxX - minX;
  const sourceHeight = maxY - minY;
  if (sourceWidth < 1 || sourceHeight < 1) return floor;

  const targetMin = 4;
  const targetSize = 92;
  const scaleX = targetSize / sourceWidth;
  const scaleY = targetSize / sourceHeight;
  const transformPoint = (point) => ({
    x: targetMin + (Number(point.x) - minX) * scaleX,
    y: targetMin + (Number(point.y) - minY) * scaleY
  });
  const transformRect = (item) => {
    const center = transformPoint({
      x: Number(item.x) + Number(item.w) / 2,
      y: Number(item.y) + Number(item.h) / 2
    });
    const width = Number(item.w) * scaleX;
    const height = Number(item.h) * scaleY;
    return {
      ...item,
      x: center.x - width / 2,
      y: center.y - height / 2,
      w: width,
      h: height
    };
  };

  return {
    ...floor,
    outline: outline.map(transformPoint),
    zones: (floor.zones || []).map((zone) => ({
      ...zone,
      points: (zone.points || []).map(transformPoint)
    })),
    elements: (floor.elements || []).map(transformRect),
    slots: (floor.slots || []).map(transformRect)
  };
}

function svgPoints(points) {
  return points.map((point) => `${toSvgX(point.x)},${point.y}`).join(" ");
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

function simplifyFloorOutline(points) {
  if (points.length <= 4) return points;
  let simplified = points.filter((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    return Math.hypot(toSvgX(point.x - previous.x), point.y - previous.y) >= 2.5;
  });
  if (simplified.length < 3) return points;

  let changed = true;
  while (changed && simplified.length > 4) {
    changed = false;
    simplified = simplified.filter((point, index) => {
      const previous = simplified[(index - 1 + simplified.length) % simplified.length];
      const next = simplified[(index + 1) % simplified.length];
      const firstAngle = Math.atan2(point.y - previous.y, toSvgX(point.x - previous.x));
      const secondAngle = Math.atan2(next.y - point.y, toSvgX(next.x - point.x));
      const delta = Math.abs(Math.atan2(Math.sin(secondAngle - firstAngle), Math.cos(secondAngle - firstAngle)));
      if (delta < 0.08) {
        changed = true;
        return false;
      }
      return true;
    });
  }
  return simplified.slice(0, 14);
}

function appendFloorOutline(svg, outline, elements) {
  const points = outline.map((point) => ({ x: toSvgX(point.x), y: point.y }));
  const edgeOpenings = points.map(() => []);
  elements.filter((element) => ["entrance", "exit"].includes(element.type)).forEach((access) => {
    const center = { x: toSvgX(access.x + access.w / 2), y: access.y + access.h / 2 };
    let nearest = null;
    points.forEach((start, edgeIndex) => {
      const end = points[(edgeIndex + 1) % points.length];
      const projection = projectPointToSegment(center, start, end);
      if (!nearest || projection.distance < nearest.distance) nearest = { ...projection, edgeIndex };
    });
    if (!nearest || nearest.distance > 18) return;
    const edgeStart = points[nearest.edgeIndex];
    const edgeEnd = points[(nearest.edgeIndex + 1) % points.length];
    const edgeLength = Math.hypot(edgeEnd.x - edgeStart.x, edgeEnd.y - edgeStart.y);
    const halfGap = clamp(Math.max(toSvgX(access.w), access.h) * 0.42, 4.2, 7.2);
    edgeOpenings[nearest.edgeIndex].push({
      start: clamp(nearest.t - halfGap / edgeLength, 0, 1),
      end: clamp(nearest.t + halfGap / edgeLength, 0, 1)
    });
  });

  points.forEach((start, edgeIndex) => {
    const end = points[(edgeIndex + 1) % points.length];
    const openings = mergeFloorIntervals(edgeOpenings[edgeIndex]);
    let cursor = 0;
    openings.forEach((opening) => {
      appendFloorOutlineSegment(svg, start, end, cursor, opening.start);
      cursor = Math.max(cursor, opening.end);
    });
    appendFloorOutlineSegment(svg, start, end, cursor, 1);
  });
}

function projectPointToSegment(point, start, end) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const t = lengthSquared
    ? clamp(((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared, 0, 1)
    : 0;
  const projected = { x: start.x + deltaX * t, y: start.y + deltaY * t };
  return { t, distance: Math.hypot(point.x - projected.x, point.y - projected.y) };
}

function mergeFloorIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  return sorted.reduce((merged, interval) => {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
    return merged;
  }, []);
}

function appendFloorOutlineSegment(svg, start, end, from, to) {
  if (to - from < 0.015) return;
  svg.appendChild(createSvgElement("line", {
    x1: start.x + (end.x - start.x) * from,
    y1: start.y + (end.y - start.y) * from,
    x2: start.x + (end.x - start.x) * to,
    y2: start.y + (end.y - start.y) * to,
    class: "floor-outline-stroke"
  }));
}

function renderSvgPlanElement(svg, element, stripePatternId) {
  const x = toSvgX(element.x);
  const y = element.y;
  const width = toSvgX(element.w);
  const height = element.h;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const uprightLabelType = ["entrance", "exit", "ramp", "ramp_up", "ramp_down"].includes(element.type);
  const transform = element.rotation && !uprightLabelType ? `rotate(${element.rotation} ${centerX} ${centerY})` : undefined;
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
  } else if (element.type === "label" && !isGenericPlanLabel(element.label)) {
    group.appendChild(createSvgElement("text", { x: centerX, y: centerY, class: "floor-label" }, element.label));
  } else if (element.type === "stripe") {
    group.appendChild(createSvgElement("rect", { x, y, width, height, fill: `url(#${stripePatternId})`, class: "floor-stripe" }));
  } else if (element.type === "lane") {
    group.appendChild(createSvgElement("rect", { x, y, width, height, rx: 0.8, class: "floor-lane-shape" }));
    if (width >= height) {
      group.appendChild(createSvgElement("line", { x1: x + 2, x2: x + width - 2, y1: centerY, y2: centerY, class: "floor-lane-center" }));
    } else {
      group.appendChild(createSvgElement("line", { x1: centerX, x2: centerX, y1: y + 2, y2: y + height - 2, class: "floor-lane-center" }));
    }
  } else if (element.type === "stair") {
    group.appendChild(createSvgElement("rect", { x, y, width, height, class: "floor-room-shape" }));
    for (let step = 1; step < 7; step += 1) {
      const lineY = y + (height / 7) * step;
      group.appendChild(createSvgElement("line", { x1: x, x2: x + width, y1: lineY, y2: lineY, class: "floor-stair-line" }));
    }
  } else if (element.type === "elevator") {
    const box = fitFloorSymbolBox(x, y, width, height, 6.5, 6.5);
    group.appendChild(createSvgElement("rect", { x: box.x, y: box.y, width: box.width, height: box.height, class: "floor-elevator-shape" }));
    group.appendChild(createSvgElement("line", { x1: box.centerX, x2: box.centerX, y1: box.y + 1, y2: box.y + box.height - 1, class: "floor-elevator-door" }));
    group.appendChild(createSvgElement("text", { x: box.centerX, y: box.centerY, class: "floor-fixed-label" }, "EV"));
  } else if (element.type === "column") {
    const radius = Math.max(1.2, Math.min(width, height) * 0.32);
    group.appendChild(createSvgElement("circle", { cx: centerX, cy: centerY, r: radius, class: "floor-column-shape" }));
  } else if (element.type === "door") {
    const radius = Math.max(2, Math.min(width, height));
    group.appendChild(createSvgElement("line", { x1: x, y1: y, x2: x + radius, y2: y, class: "floor-door-frame" }));
    group.appendChild(createSvgElement("line", { x1: x, y1: y, x2: x, y2: y + radius, class: "floor-door-leaf" }));
    group.appendChild(createSvgElement("path", {
      d: `M ${x + radius} ${y} A ${radius} ${radius} 0 0 0 ${x} ${y + radius}`,
      class: "floor-door-swing"
    }));
  } else if (["entrance", "exit"].includes(element.type)) {
    const box = fitFloorSymbolBox(x, y, width, height, 12, 8);
    appendFloorGate(group, box, element.type);
  } else if (["ramp", "ramp_up", "ramp_down"].includes(element.type)) {
    const box = fitFloorSymbolBox(x, y, width, height, 15, 10);
    appendFloorRamp(group, box, element.type, stripePatternId, element.rotation);
  } else if (element.type === "camera") {
    const radius = Math.max(1.1, Math.min(width, height) * 0.2);
    group.appendChild(createSvgElement("circle", { cx: x + width * 0.32, cy: centerY, r: radius, class: "floor-camera-body" }));
    group.appendChild(createSvgElement("path", {
      d: `M ${x + width * 0.42} ${centerY - radius} L ${x + width * 0.82} ${y + height * 0.18} L ${x + width * 0.82} ${y + height * 0.82} L ${x + width * 0.42} ${centerY + radius} Z`,
      class: "floor-camera-view"
    }));
  } else {
    group.appendChild(createSvgElement("rect", { x, y, width, height, class: "floor-element-shape" }));
    const labeledTypes = new Set(["room", "obstacle"]);
    const fallbackLabel = labeledTypes.has(element.type) ? element.label : "";
    if (fallbackLabel) {
      group.appendChild(createSvgElement("text", { x: centerX, y: centerY, class: "floor-element-label" }, fallbackLabel));
    }
  }
  svg.appendChild(group);
}

function fitFloorSymbolBox(x, y, width, height, minWidth, minHeight) {
  const fittedWidth = Math.max(width, minWidth);
  const fittedHeight = Math.max(height, minHeight);
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const fittedX = clamp(centerX - fittedWidth / 2, 1, 159 - fittedWidth);
  const fittedY = clamp(centerY - fittedHeight / 2, 1, 99 - fittedHeight);
  return {
    x: fittedX,
    y: fittedY,
    width: fittedWidth,
    height: fittedHeight,
    centerX: fittedX + fittedWidth / 2,
    centerY: fittedY + fittedHeight / 2
  };
}

function appendFloorGate(group, box, type) {
  group.appendChild(createSvgElement("text", {
    x: box.centerX,
    y: box.centerY,
    class: "floor-fixed-label floor-gate-label"
  }, type === "entrance" ? "입구" : "출구"));
}

function appendFloorRamp(group, box, type, stripePatternId, rotation = 0) {
  const rampLabel = type === "ramp_up" ? "상행" : type === "ramp_down" ? "하행" : "경사로";
  const symbol = createSvgElement("g", rotation ? {
    transform: `rotate(${rotation} ${box.centerX} ${box.centerY})`
  } : {});
  symbol.appendChild(createSvgElement("rect", { x: box.x, y: box.y, width: box.width, height: box.height, class: "floor-ramp-shape" }));
  symbol.appendChild(createSvgElement("rect", {
    x: box.x + 0.7,
    y: box.y + 0.7,
    width: Math.max(0.6, box.width - 1.4),
    height: Math.max(0.6, box.height - 1.4),
    fill: `url(#${stripePatternId})`,
    class: "floor-ramp-stripes"
  }));
  group.appendChild(symbol);
  group.appendChild(createSvgElement("text", {
    x: box.centerX,
    y: box.y + box.height * 0.82,
    class: "floor-fixed-label floor-ramp-label"
  }, rampLabel));
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
  const files = Array.from(els.planImages.files || []);
  els.planImages.value = "";
  await handlePlanFiles(files);
}

let planUploadQueue = Promise.resolve();
let planImageRevision = 0;

async function handlePlanFiles(selectedFiles) {
  if (state.planBusy || !selectedFiles.length) return;
  const revision = planImageRevision;
  planUploadQueue = planUploadQueue.then(async () => {
    if (revision !== planImageRevision) return;
    els.generatePlanButton.disabled = true;
    els.planImageCount.textContent = "사진을 읽는 중...";
    const notices = new Set();
    for (const file of selectedFiles) {
      if (revision !== planImageRevision) return;
      if (!file.type.startsWith("image/")) { notices.add("이미지 파일을 선택해 주세요."); continue; }
      const fileId = `${file.name}:${file.size}:${file.lastModified}`;
      if (state.planImages.some(image => image.fileId === fileId)) continue;
      if (state.planImages.length >= 6) { notices.add("사진은 최대 6장까지 추가할 수 있습니다."); break; }
      try {
        const image = await imageFileToGeminiPart(file);
        if (revision !== planImageRevision) return;
        state.planImages.push({ ...image, fileId, name: file.name, floor: getRequestedFloorNames()[0] });
        state.planGenerated = false;
      } catch {
        notices.add("읽을 수 없는 사진이 있습니다. JPG, PNG 또는 WebP로 다시 선택해 주세요.");
      }
    }
    renderPlanImages();
    els.geminiStatus.textContent = [...notices].join(" ");
  }).finally(() => {
    if (revision === planImageRevision && !state.planBusy) els.generatePlanButton.disabled = false;
  });
  return planUploadQueue;
}

function renderPlanImages() {
  const floors = getRequestedFloorNames();
  els.planImagePreview.replaceChildren();
  state.planImages.forEach((image, index) => {
    const item = document.createElement("div");
    item.className = "plan-photo";
    const preview = document.createElement("img");
    preview.src = image.previewUrl;
    preview.alt = image.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "plan-photo-remove";
    remove.setAttribute("aria-label", `사진 ${index + 1} 삭제`);
    remove.innerHTML = '<i data-lucide="x"></i>';
    remove.addEventListener("click", () => {
      if (state.planBusy) return;
      state.planImages = state.planImages.filter(entry => entry !== image);
      state.planGenerated = false;
      renderPlanImages();
    });
    const select = document.createElement("select");
    select.setAttribute("aria-label", `사진 ${index + 1}의 층`);
    select.add(new Option("층 선택", ""));
    floors.forEach(floor => select.add(new Option(floorDisplayName(floor), floor)));
    select.value = floors.includes(image.floor) ? image.floor : "";
    image.floor = select.value;
    select.addEventListener("change", () => { image.floor = select.value; });
    item.append(preview, remove, select);
    els.planImagePreview.appendChild(item);
  });
  els.planUploadBox.classList.toggle("has-files", state.planImages.length > 0);
  els.planImageCount.textContent = `사진 ${state.planImages.length} / 6장`;
  refreshIcons();
}

async function generatePlanFromPrompt() {
  if (state.planBusy) return;
  await planUploadQueue;
  if (state.planBusy) return;
  const floorNames = getRequestedFloorNames();
  if (floorNames.length > 6) {
    els.geminiStatus.textContent = "한 번에 최대 6개 층을 등록할 수 있습니다.";
    return;
  }
  if (state.planImages.some(image => !image.floor)) {
    els.geminiStatus.textContent = "각 사진의 층을 선택해 주세요.";
    return;
  }
  const missingFloors = floorNames.filter(floor => !state.planImages.some(image => image.floor === floor));
  if (missingFloors.length) {
    els.geminiStatus.textContent = `${missingFloors.map(floorDisplayName).join(", ")} 사진을 추가해 주세요.`;
    return;
  }
  for (const input of [els.registerTotalSpaces, els.registerDisabledSpaces, els.registerPregnantSpaces]) {
    if (!input.disabled && (!input.value || !input.reportValidity())) {
      els.geminiStatus.textContent = "주차면 수를 입력 범위에 맞게 확인해 주세요.";
      return;
    }
  }
  const revision = planImageRevision;
  setPlanBusy(true);
  els.geminiStatus.textContent = "분석 서버 연결 확인 중...";
  await loadRuntimeConfig();
  if (revision !== planImageRevision) return;
  if (!state.runtimeConfig?.geminiConfigured) {
    els.geminiStatus.textContent = state.runtimeConfig?.backendConnected
      ? "분석 서버의 AI 설정이 준비되지 않았습니다."
      : "AI 분석 서버가 연결되지 않았습니다. 사진은 그대로 보관됩니다.";
    setPlanBusy(false);
    return;
  }

  if (state.planImages.length > 0) {
    try {
      const generatedFloors = [];
      for (let index = 0; index < floorNames.length; index += 1) {
        const floorName = floorNames[index];
        els.geminiStatus.textContent = `Gemini가 ${floorName} 도면을 생성하는 중입니다... (${index + 1}/${floorNames.length})`;
        const generated = await generatePlanWithGemini(floorName, index, floorNames.length);
        if (revision !== planImageRevision) return;
        generatedFloors.push(polishGeneratedFloor({ ...generated[0], name: floorName }));
      }
      applyGeneratedFloors(generatedFloors);
      clearPlanImages();
      state.planGenerated = true;
      els.geminiStatus.textContent = `사진 기반 도면 생성 완료: ${generatedFloors.map((floor) => `${floor.name} ${floor.slots.length}면`).join(" / ")}`;
      setRegistrationStep(3);
      return;
    } catch (error) {
      if (revision !== planImageRevision) return;
      els.geminiStatus.textContent = `Gemini 생성 실패: ${error.message}`;
      return;
    } finally {
      if (revision === planImageRevision) setPlanBusy(false);
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
  state.planGenerated = true;
  els.geminiStatus.textContent = `규칙 기반 도면 생성 완료: ${floors.map((floor) => `${floor.name} ${floor.slots.length}면`).join(" / ")}`;
  setRegistrationStep(3);
}

function clearPlanImages() {
  planImageRevision += 1;
  setPlanBusy(false);
  state.planImages = [];
  els.planImages.value = "";
  els.planImagePreview.replaceChildren();
  els.planUploadBox.classList.remove("has-files");
  els.planImageCount.textContent = "선택된 사진 0장";
}

function getRequestedFloorNames() {
  const start = parseFloorName(els.floorStart.value, "B1");
  const end = parseFloorName(els.floorEnd.value, start.label);
  const low = start.kind === "basement" ? -start.number : start.number;
  const high = end.kind === "basement" ? -end.number : end.number;
  const floors = [];
  for (let number = Math.min(low, high); number <= Math.max(low, high); number += 1) {
    if (number !== 0) floors.push(number < 0 ? `B${-number}` : `${number}F`);
  }
  return floors;
}

function floorDisplayName(floor) {
  const parsed = parseFloorName(floor, "B1");
  return `${parsed.kind === "basement" ? "지하 " : "지상 "}${parsed.number}층`;
}

function initializePlanControls() {
  for (const select of [els.floorStart, els.floorEnd]) {
    for (let floor = -8; floor <= 50; floor += 1) {
      if (!floor) continue;
      const value = floor < 0 ? `B${-floor}` : `${floor}F`;
      select.add(new Option(floorDisplayName(value), value));
    }
    select.value = "B1";
    select.addEventListener("change", () => {
      if (els.floorStart.selectedIndex > els.floorEnd.selectedIndex) {
        (select === els.floorStart ? els.floorEnd : els.floorStart).value = select.value;
      }
      updateRequestedFloors();
      renderPlanImages();
      state.planGenerated = false;
    });
  }
  document.querySelector("#planAutoCount").addEventListener("change", (event) => {
    els.registerTotalSpaces.disabled = event.target.checked;
    els.registerTotalSpaces.value = event.target.checked ? "" : "1";
    state.planGenerated = false;
  });
  document.querySelectorAll("[data-step-target]").forEach(button => {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.stepTarget);
      if (input === els.registerTotalSpaces && input.disabled) {
        document.querySelector("#planAutoCount").checked = false;
        input.disabled = false;
      }
      input.value = String(clamp((Number(input.value) || 0) + Number(button.dataset.step), Number(input.min), Number(input.max)));
      state.planGenerated = false;
    });
  });
  updateRequestedFloors();
}

function updateRequestedFloors() {
  const floors = getRequestedFloorNames();
  document.querySelector("#planFloorSummary").textContent = floors.length > 6
    ? "한 번에 최대 6개 층을 선택해 주세요."
    : `${floors.join(" · ")} / 총 ${floors.length}개 층`;
}

function setPlanBusy(busy) {
  state.planBusy = busy;
  document.querySelectorAll('[data-registration-step="plan"] input, [data-registration-step="plan"] select, [data-registration-step="plan"] button').forEach(control => {
    control.disabled = busy;
  });
  if (!busy) els.registerTotalSpaces.disabled = document.querySelector("#planAutoCount").checked;
  els.generatePlanButton.textContent = busy ? "도면 생성 중..." : "AI 도면 생성";
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
  const imageParts = state.planImages.filter(image => image.floor === floorName).flatMap((image, index) => [
    { text: `참고 사진 ${index + 1}: ${floorName}의 동일한 주차장을 다른 위치에서 촬영한 사진` },
    {
      inline_data: {
        mime_type: image.mimeType,
        data: image.base64
      }
    }
  ]);

  const generationConfig = {
    temperature: 0,
    maxOutputTokens: 32768,
    responseMimeType: "application/json",
    responseSchema: floorPlanSchema()
  };
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
    generationConfig
  });

  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!text) throw new Error("응답에 도면 JSON이 없습니다.");
  const parsed = JSON.parse(stripJsonFence(text));
  const draftFloors = validateGeneratedFloors(parsed);

  try {
    const reviewedPayload = await requestGeminiGeneration({
      contents: [
        {
          role: "user",
          parts: [
            { text: geminiPlanReviewPrompt(floorName, parsed) },
            ...imageParts
          ]
        }
      ],
      generationConfig
    });
    const reviewedText = reviewedPayload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();
    if (reviewedText) {
      const reviewed = JSON.parse(stripJsonFence(reviewedText));
      return validateGeneratedFloors(reviewed);
    }
  } catch (error) {
    console.warn("[ParkView] floor plan review skipped", error);
  }
  return draftFloors;
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

function geminiPlanPrompt(floorName, floorIndex, floorTotal) {
  const instruction = els.planPrompt.value || DEFAULT_PLAN_INSTRUCTION;
  const enteredTotal = Number(els.registerTotalSpaces?.value);
  const expectedTotal = enteredTotal > 0 ? `${enteredTotal}면` : "미입력(사진에서 직접 계산)";
  const expectedDisabled = Math.max(0, Number(els.registerDisabledSpaces?.value) || 0);
  const expectedPregnant = Math.max(0, Number(els.registerPregnantSpaces?.value) || 0);
  return `
너는 항공·드론·고정 카메라 사진을 실제 2D 주차장 평면도로 복원하는 측량 CAD 변환기다. 색칠된 예시 배치도를 새로 디자인하지 말고, 사진에 존재하는 주차열과 차로의 위상 관계를 탑뷰로 복원해라.

사용자 입력 참고값: 전체 예상 ${expectedTotal}, 장애인 ${expectedDisabled}면, 임산부 ${expectedPregnant}면. 숫자를 맞추기 위해 사진에 없는 칸을 만들지 말고 사진을 우선한다.

반드시 아래 규칙을 지켜라.
- 출력은 JSON만 반환한다.
- 지금 생성할 층은 ${floorName}이다. 전체 ${floorTotal}개 층 중 ${floorIndex + 1}번째다.
- floors 배열에는 반드시 ${floorName} 한 층만 넣는다.
- aspectRatio는 원근을 제거한 실제 주차 구역의 가로 길이 ÷ 세로 길이다. 사진 파일 전체나 화면 비율이 아니라 주차선이 놓인 바닥 영역의 실측 비율을 1~3.2 사이로 기록한다. 긴 가로형 배치를 정사각형으로 압축하지 않는다.
- 첨부 사진이 여러 장이면 같은 장소를 다른 방향에서 본 보조 사진으로 취급한다. 가장 넓은 전경을 기준 좌표계로 사용하고, 다른 사진은 가려진 칸과 특수 표식을 확인하는 데만 사용한다. 중복 주차면을 두 번 세거나 서로 모순되는 별도 구조를 이어 붙이지 않는다.
- 먼저 각 사진에서 독립된 주차열을 찾고, 각 열의 면수·방향·맞은편 열·사이 차로·출입구 순서를 내부적으로 표로 정리한 다음 JSON 좌표를 작성한다.
- 모든 x/y/w/h/rotation은 카메라 화면의 원근 좌표가 아니라 원근을 제거한 최종 탑뷰 좌표다. 좌상단이 0,0이고 우하단이 100,100이다.
- outline은 사진에서 확인되는 주차장 포장면의 외벽을 시계방향으로 기록한다. 핵심 모서리 4~12개만 사용하고, 짧은 꺾임·톱니 모양·차량 윤곽을 외벽으로 만들지 않는다. 출입구가 있어도 polygon은 닫되 entrance/exit의 중심을 실제 외벽 개구부 위에 정확히 둔다. 앱이 그 좌표에서 외벽을 끊는다.
- zones는 빈 배열로 둔다. 이 도면에서는 주차면 외의 보행로·완충 구역·차로·방·기둥을 그리지 않는다.
- JSON을 작성하기 전에 소실점과 평행 방향을 찾고, 도로 경계와 주차선이 탑뷰에서 평행·직각이 되도록 원근을 제거한다.
- 빨강/초록 테두리와 0/1은 슬롯 경계와 점유 상태를 읽는 참고 정보일 뿐, 도면에 색 면·숫자·장식으로 그리지 않는다.
- rows 배열에는 사진에서 연속된 주차열 하나당 객체 하나를 넣는다. 곡선이나 방향이 바뀌는 열은 직선 구간별로 나눈다.
- 흰색 주차선으로 양옆 경계가 닫힌 차량 한 대 크기의 직사각형만 주차면으로 센다. 사선 빗금 영역, 휠스토퍼, 보행 통로, 차로 화살표, 종이 연결선은 주차면이 아니다.
- 인쇄된 여러 판이나 이음선으로 한 주차열이 나뉘어 있으면 판마다 칸을 먼저 센 뒤 합계를 확인한다. 예를 들어 같은 열이 3칸, 4칸, 4칸으로 나뉘면 총 11칸이며 중간 구간 count는 반드시 4다.
- row의 startX/startY는 첫 번째 주차면 중심, endX/endY는 마지막 주차면 중심의 최종 탑뷰 좌표다. 두 점을 잇는 선은 주차열의 진행축이며 모든 칸 중심이 그 직선 위에 동일 간격으로 놓여야 한다.
- row의 count는 그 열의 전체 면수다. w는 회전 전 주차면의 짧은 폭, h는 긴 깊이이며 항상 w<h로 둔다. rotation은 긴 축이 세로일 때 0도, 가로일 때 90도인 탑뷰 회전 각도다.
- 같은 층의 모든 row는 동일한 w와 h를 사용한다. 사진 원근 때문에 가까운 칸을 크게, 먼 칸을 작게 만들지 않는다.
- statuses와 kinds 배열은 첫 칸부터 마지막 칸 순서이며 길이가 반드시 count와 같아야 한다.
- detectedSlotCount는 모든 rows의 count 합계와 같아야 한다. 반복되는 열을 대표 3~4칸으로 줄이거나 생략하지 않는다.
- 차량 때문에 주차선이 가려져도 같은 열의 규칙적인 간격과 차량 중심을 사용해 차량 한 대당 주차면 하나를 복원한다. 빈 칸과 차량이 있는 칸을 모두 센다.
- 좌표는 전체 도면 기준 퍼센트이며 0~100 범위다.
- kinds 값은 normal, disabled, pregnant 중 하나다.
- statuses 값은 occupied 또는 available 중 하나다.
- 사진에 차량이 있거나 빨강/1로 표시된 칸은 occupied, 차량이 없고 초록/0으로 표시된 칸은 available로 둔다.
- 장애인 주차면은 실제 휠체어 바닥 도색이나 표지가 보일 때만 disabled로 둔다.
- 임산부/여성 우선 주차면은 실제 바닥 도색이나 표지가 보일 때만 pregnant로 둔다.
- 사용자 입력에 장애인·임산부 숫자가 있어도 사진에서 위치를 확인할 수 없으면 일반 칸을 임의로 특수 칸으로 바꾸지 않는다.
- 파란 바탕의 휠체어 표시는 disabled로, 분홍 바탕의 특수 주차 표시는 pregnant로 분류한다.
- 실제 사진이 아니라 색으로 구분된 주차 배치도라면 초록 칸은 available, 회색 칸은 occupied로 그대로 분류한다. 파랑과 분홍 칸의 점유 상태는 색만으로 추측하지 말고, 특수 주차면 종류는 각각 disabled와 pregnant로 보존한다.
- 사진에 보이지 않는 구조를 임의로 추가하지 않는다. 사진에 보이는 외벽은 outline에 기록하고, 실제 출입구가 선명하게 보일 때만 elements에 기록한다.
- 사진 바깥 배경과 주차장 밖의 건물·나무·보행로는 도면 요소로 만들지 않는다.
- elements에는 실제 외벽 개구부가 보이는 경우에만 entrance 또는 exit를 넣는다. 그 밖의 lane, stripe, arrow, wall, divider, room, obstacle 요소는 절대 생성하지 않는다.
- 사진 속 차량 진행 화살표와 사선 빗금 완충 구역은 분석 참고 대상에서도 제외한다. 도면에는 주차칸으로도 요소로도 넣지 않는다.
- entrance와 exit는 서로 독립적으로 실제 위치를 판독한다. 각각의 중심은 outline의 실제 개구부 선분 위에 두고 w/h는 차량 통로의 개구 폭을 나타내게 한다. 한쪽 위치를 기준으로 다른 쪽을 임의 생성하거나 둘을 같은 위치로 합치지 않는다.
- 모든 element에는 사진에서 실제로 확인한 정도를 confidence 0~1로 넣는다. entrance와 exit는 개구부·차단기·연결 도로처럼 직접 보이는 근거가 있어 confidence가 0.82 이상일 때만 만든다. 진행 방향을 추측하지 않는다.
- 기울어진 요소는 rotation에 각도를 넣는다. 외곽 전체를 하나의 큰 사각형으로 덮어 구조를 숨기면 안 된다.
- 사선 완충 구역과 CCTV 오버레이의 선·숫자는 모두 무시한다.
- 주차면은 사진에서 보이는 위치와 방향을 우선한다. 앱이 보기 좋게 만들려고 임의로 상단/하단/좌우 템플릿에 맞추지 않는다.
- 주차면이 행(row)이나 열(column)을 이루면 개수, 앞뒤·좌우 순서, 간격, 방향을 그대로 유지한다. 사진의 깊이 방향 배치를 임의의 가로 한 줄로 펴지 않는다.
- 서로 마주 보는 열은 각각 독립적으로 센다. detectedSlotCount 총합을 맞추려고 위쪽 열에서 빠진 칸을 아래쪽 열에 추가하거나 반대로 옮기지 않는다.
- 주차면 하나는 실제 약 2.3~2.5m × 5m 비율처럼 짧은 변 대비 긴 변이 1.8~2.4배인 직사각형이어야 한다. 정사각형이나 작은 막대로 만들지 않는다.
- 사진 중앙이 비어 있으면 그대로 빈 공간으로 남긴다.
- 주차면끼리 절대 겹치지 않게 배치한다.
- 장애인/임산부 특수 주차면도 사진에 보이는 실제 위치에 둔다.
- 보드가 가로로 길면 도면도 가로형으로 구성하고, 중앙 차로가 넓으면 그 비율을 줄이지 않는다.
- 결과 좌표는 단순한 탑뷰 배치도여야 한다. 장식보다 외곽 모양, 주차열 위치, 각도, 칸 수, 동일 간격을 우선한다.
- entrance와 exit는 주차면 열 바깥의 실제 외벽 개구부에 두고, 각 중심과 가장 가까운 outline 선분 사이 거리가 2 좌표 단위 이하여야 한다.
- 슬롯 번호나 임의의 숫자는 elements에 추가하지 않는다.
- zones는 빈 배열이며 모든 element의 label도 빈 문자열이다.
- outline이 외곽선을 나타내므로 동일한 외곽을 boundary element로 중복 생성하지 않는다.
- 응답 직전에 detectedSlotCount와 rows의 count 합계가 같은지 다시 확인한다.
- 사진에서 확인할 수 없는 구조나 층을 복제하지 않는다.

내부 지시:
${instruction}
`;
}

function geminiPlanReviewPrompt(floorName, draft) {
  return `
너는 2D 주차장 도면의 최종 검수자다. 아래 초안 JSON과 첨부된 원본 사진을 다시 대조하고, 틀린 좌표를 고친 완전한 대체 JSON만 반환해라.

검수 대상 층: ${floorName}
초안 JSON:
${JSON.stringify(draft)}

검수 순서:
1. 사진에서 독립된 주차열을 다시 찾고 각 열의 실제 칸 수를 처음부터 센다.
2. 흰색 세로 경계로 닫힌 차량 한 대 크기의 직사각형만 센다. 사선 빗금 완충 구역과 화살표는 주차면도 element도 아니다. 인쇄 판이 3칸·4칸·4칸으로 나뉘면 각 구간 수와 총 11칸을 모두 보존한다. 위쪽과 아래쪽 열의 칸 수는 따로 검산하며 총합을 맞추기 위해 칸을 반대편으로 옮기지 않는다.
3. 각 열의 첫 칸 중심과 마지막 칸 중심, 열의 각도, 맞은편 열과의 거리를 사진의 원근을 제거한 탑뷰 좌표로 다시 맞춘다.
4. 같은 열의 모든 칸은 동일 크기, 동일 각도, 동일 중심 간격이어야 한다. 서로 겹치거나 외벽 밖으로 나가면 좌표를 수정한다.
5. aspectRatio는 사진 전체가 아니라 원근을 제거한 실제 주차 배치의 가로÷세로 비율로 다시 측정한다. 긴 배치를 정사각형으로 압축하지 않는다.
6. outline은 차량이나 나무 윤곽이 아니라 실제 포장면 외벽의 핵심 모서리 4~12개만 사용한다.
7. entrance와 exit를 사진에서 각각 독립적으로 찾고, 각 중심을 실제 outline 개구부 선분 위에 둔다. 사진에 없으면 elements를 빈 배열로 둔다.
8. elements와 zones에는 주차칸 외의 사선 구역·차로·화살표·벽·보행 공간을 만들지 않는다.
9. statuses와 kinds는 사진에서 확인되는 경우에만 수정한다. 색상 배치도에서는 초록=available, 회색=occupied, 파랑=disabled, 분홍=pregnant를 보존하고 장식이나 추측 구조물을 추가하지 않는다.
10. detectedSlotCount와 모든 rows의 count 합계가 반드시 같아야 한다.

초안이 맞는 부분은 유지하되, 사진과 다른 칸 수·행 위치·각도·간격·외곽·출입구는 반드시 교정한다. floors에는 ${floorName} 한 층만 넣고 전체 JSON을 반환한다.
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
            aspectRatio: { type: "NUMBER" },
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
                  type: { type: "STRING", enum: ["entrance", "exit"] },
                  label: { type: "STRING" },
                  x: { type: "NUMBER" },
                  y: { type: "NUMBER" },
                  w: { type: "NUMBER" },
                  h: { type: "NUMBER" },
                  rotation: { type: "NUMBER" },
                  confidence: { type: "NUMBER" }
                },
                required: ["type", "x", "y", "w", "h", "confidence"]
              }
            },
            detectedSlotCount: { type: "INTEGER" },
            rows: {
              type: "ARRAY",
              minItems: 1,
              items: {
                type: "OBJECT",
                properties: {
                  startX: { type: "NUMBER" },
                  startY: { type: "NUMBER" },
                  endX: { type: "NUMBER" },
                  endY: { type: "NUMBER" },
                  count: { type: "INTEGER" },
                  w: { type: "NUMBER" },
                  h: { type: "NUMBER" },
                  rotation: { type: "NUMBER" },
                  statuses: {
                    type: "ARRAY",
                    items: { type: "STRING", enum: ["occupied", "available"] }
                  },
                  kinds: {
                    type: "ARRAY",
                    items: { type: "STRING", enum: ["normal", "disabled", "pregnant"] }
                  }
                },
                required: ["startX", "startY", "endX", "endY", "count", "w", "h", "rotation", "statuses", "kinds"]
              }
            }
          },
          required: ["name", "aspectRatio", "outline", "zones", "elements", "detectedSlotCount", "rows"]
        }
      }
    },
    required: ["floors"]
  };
}

function validateGeneratedFloors(plan) {
  const floors = Array.isArray(plan?.floors) ? plan.floors : [];
  const validFloors = floors.map((floor, floorIndex) => {
    const aspectRatio = normalizeFloorAspectRatio(floor.aspectRatio);
    const slots = expandGeneratedRows(floor.rows, aspectRatio);
    return {
      name: String(floor.name || `B${floorIndex + 1}`),
      aspectRatio,
      detectedSlotCount: slots.length,
      outline: normalizeFloorPoints(floor.outline, 3),
      zones: [],
      elements: Array.isArray(floor.elements)
        ? floor.elements
          .map(normalizeGeneratedElement)
          .filter((element) => element
            && ["entrance", "exit"].includes(element.type)
            && element.confidence >= 0.82)
        : [],
      slots
    };
  }).filter((floor) => floor.slots.length > 0);

  if (validFloors.length === 0) throw new Error("유효한 주차면이 없습니다.");
  return validFloors.slice(0, 8);
}

function expandGeneratedRows(rows, aspectRatio = FLOOR_PLAN_X_SCALE) {
  const slots = [];
  if (!Array.isArray(rows)) return slots;

  rows.slice(0, 60).forEach((row, rowIndex) => {
    const count = clamp(Math.round(Number(row.count) || 0), 1, 80);
    const startX = clamp(Number(row.startX), 1, 99);
    const startY = clamp(Number(row.startY), 1, 99);
    const endX = clamp(Number(row.endX), 1, 99);
    const endY = clamp(Number(row.endY), 1, 99);
    const rawW = clamp(Number(row.w), 1.5, 30);
    const rawH = clamp(Number(row.h), 1.5, 30);
    if (![startX, startY, endX, endY, rawW, rawH].every(Number.isFinite)) return;
    const shortSide = Math.min(rawW, rawH);
    const longSide = clamp(Math.max(rawW, rawH), shortSide * 1.8, shortSide * 2.4);
    const rowDeltaX = (endX - startX) * aspectRatio;
    const rowDeltaY = endY - startY;
    const rowRotation = count > 1 && Math.hypot(rowDeltaX, rowDeltaY) > 1
      ? Math.atan2(rowDeltaY, rowDeltaX) * 180 / Math.PI
      : clamp(Number(row.rotation) || 0, -180, 180);

    for (let index = 0; index < count && slots.length < 240; index += 1) {
      const progress = count === 1 ? 0 : index / (count - 1);
      const centerX = startX + (endX - startX) * progress;
      const centerY = startY + (endY - startY) * progress;
      const status = row.statuses?.[index] === "available" ? "available" : "occupied";
      const kind = ["disabled", "pregnant"].includes(row.kinds?.[index]) ? row.kinds[index] : "normal";
      const slotWidth = shortSide / aspectRatio;
      const slot = normalizeGeneratedSlot({
        kind,
        status,
        x: centerX - slotWidth / 2,
        y: centerY - longSide / 2,
        w: slotWidth,
        h: longSide,
        rotation: rowRotation,
        rowIndex,
        rowPosition: index
      });
      if (slot) slots.push(slot);
    }
  });

  return slots;
}

function normalizeGeneratedElement(element) {
  const type = ["boundary", "wall", "divider", "lane", "room", "stair", "elevator", "door", "entrance", "exit", "ramp", "ramp_up", "ramp_down", "column", "camera", "obstacle", "label", "stripe", "arrow"].includes(element.type)
    ? element.type
    : "obstacle";
  const x = clamp(Number(element.x), 0, 98);
  const y = clamp(Number(element.y), 0, 98);
  const w = clamp(Number(element.w), 1, 100);
  const h = clamp(Number(element.h), 1, 100);
  const confidence = Number.isFinite(Number(element.confidence))
    ? clamp(Number(element.confidence), 0, 1)
    : 1;

  if (![x, y, w, h].every(Number.isFinite)) return null;
  return {
    type,
    label: String(element.label || "").slice(0, 12),
    x: Math.min(x, 100 - w),
    y: Math.min(y, 100 - h),
    w,
    h,
    rotation: clamp(Number(element.rotation) || 0, -180, 180),
    confidence
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
    rowIndex: Number.isInteger(slot.rowIndex) ? slot.rowIndex : null,
    rowPosition: Number.isInteger(slot.rowPosition) ? slot.rowPosition : null,
    sourcePolygon: normalizeFloorPoints(slot.sourcePolygon, 4).slice(0, 4),
    adjacentSlots: Array.isArray(slot.adjacentSlots)
      ? slot.adjacentSlots.map(Number).filter((value) => Number.isInteger(value) && value > 0).slice(0, 8)
      : []
  };
}

function normalizeParkingSlotRect(rawX, rawY, rawW, rawH) {
  const centerX = clamp(rawX + rawW / 2, 4, 96);
  const centerY = clamp(rawY + rawH / 2, 4, 96);
  const w = clamp(rawW, 1.5, 30);
  const h = clamp(rawH, 1.5, 30);

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
    aspectRatio: normalizeFloorAspectRatio(floor.aspectRatio),
    outline: normalizeFloorPoints(floor.outline, 3),
    zones: [],
    elements: (floor.elements || []).map(cleanGeneratedElement).filter(Boolean),
    slots: preserveGeneratedLayout(floor.slots || [])
  };
}

function cleanGeneratedElement(element) {
  if (!element || !["entrance", "exit"].includes(element.type)) return null;
  if (element.confidence < 0.82) return null;
  return { ...element, label: "" };
}

function preserveGeneratedLayout(slots) {
  const preserved = [];

  slots.slice(0, 240).forEach((slot) => {
    const clean = {
      ...slot,
      x: clamp(Number(slot.x), 1, 99 - Number(slot.w)),
      y: clamp(Number(slot.y), 1, 99 - Number(slot.h)),
      w: clamp(Number(slot.w), 1.5, 30),
      h: clamp(Number(slot.h), 1.5, 30)
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

function toggleCameraConnectionForm() {
  if (!els.cameraConnectionForm || !els.cameraSetupToggle) return;
  const opening = els.cameraConnectionForm.hidden;
  els.cameraConnectionForm.hidden = !opening;
  els.cameraSetupToggle.setAttribute("aria-expanded", String(opening));
  if (!opening) return;
  const directMode = isDirectCameraMode();
  const nativeMode = window.ParkViewNative?.supportsCctv === true;
  if (els.cameraAdminTokenField) els.cameraAdminTokenField.hidden = nativeMode || directMode;
  if (els.cameraOpenButton) els.cameraOpenButton.hidden = nativeMode || !directMode || !state.directCameraUrl;
  const label = els.cameraConnectButton?.querySelector("span");
  if (label) label.textContent = nativeMode
    ? "CCTV 직접 연결"
    : directMode ? "링크 연결" : "연결 및 테스트";
  if (nativeMode) {
    els.cameraRtspUrl.value = "";
  } else if (directMode) {
    els.cameraRtspUrl.value = state.directCameraUrl;
  } else {
    try {
      els.cameraAdminToken.value = sessionStorage.getItem(CAMERA_ADMIN_TOKEN_SESSION) || "";
    } catch (_error) {
      els.cameraAdminToken.value = "";
    }
  }
  window.setTimeout(() => els.cameraRtspUrl?.focus(), 0);
}

function normalizeCameraLink(value) {
  const candidate = String(value || "").trim();
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (_error) {
    throw new Error("올바른 카메라 링크를 입력해 주세요.");
  }
  if (!["rtsp:", "rtsps:", "http:", "https:"].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error("rtsp://, rtsps://, http:// 또는 https:// 링크를 입력해 주세요.");
  }
  return parsed.href;
}

function loadDirectCameraLink() {
  try {
    const stored = sessionStorage.getItem(DIRECT_CAMERA_LINK_SESSION);
    return stored ? normalizeCameraLink(stored) : "";
  } catch (_error) {
    return "";
  }
}

function saveDirectCameraLink(url) {
  state.directCameraUrl = url;
  try {
    sessionStorage.setItem(DIRECT_CAMERA_LINK_SESSION, url);
  } catch (_error) {
    // A restricted web view can block session storage; the in-memory link still works.
  }
}

function isDirectCameraMode() {
  return !cameraApiUrl("/api/camera/test");
}

function loadRecentDeviceCameraResult() {
  try {
    const result = JSON.parse(localStorage.getItem(DEVICE_CAMERA_RESULT_STORAGE) || "null");
    const analyzedAt = new Date(result?.analyzedAt || "").getTime();
    if (!Number.isFinite(analyzedAt) || Date.now() - analyzedAt > 5 * 60 * 1000) return null;
    return result;
  } catch (_error) {
    return null;
  }
}

function renderDeviceCameraStatus() {
  const result = loadRecentDeviceCameraResult();
  if (!result) return false;
  const isCctv = result.source === "cctv";
  els.cameraConnectionChip.textContent = isCctv ? "CCTV 직접 연결" : "기기 내 AI";
  els.cameraConnectionChip.classList.remove("is-linked", "is-error", "is-manual");
  els.cameraConnectionChip.classList.add("is-live");
  els.cameraStatus.textContent = "분석 완료";
  if (els.cameraIntervalStatus) els.cameraIntervalStatus.textContent = "실시간";
  els.analysisStatus.textContent = formatAnalysisTime(result.analyzedAt);
  els.objectStatus.textContent = `${isCctv ? "고정 CCTV" : "기기 카메라"}에서 차량 ${Number(result.count) || 0}대를 감지했습니다.`;
  return true;
}

function renderNativeCctvStatus() {
  if (!state.nativeCctvConnected) return false;
  els.cameraConnectionChip.textContent = "CCTV 직접 연결";
  els.cameraConnectionChip.classList.remove("is-linked", "is-error", "is-manual");
  els.cameraConnectionChip.classList.add("is-live");
  els.cameraStatus.textContent = "프레임 수신 중";
  if (els.cameraIntervalStatus) els.cameraIntervalStatus.textContent = "2초";
  els.analysisStatus.textContent = "연결됨";
  els.objectStatus.textContent = "아이폰이 CCTV 사진을 직접 받아 기기 내 AI로 분석합니다.";
  return true;
}

function handleNativeCctvState(event) {
  const detail = event.detail || {};
  if (detail.status === "connected") {
    state.nativeCctvConnected = true;
    renderNativeCctvStatus();
    return;
  }
  if (detail.status === "connecting") {
    els.cameraConnectionChip.textContent = "CCTV 연결 중";
    els.cameraStatus.textContent = "프레임 확인 중";
    return;
  }
  if (detail.status === "error") {
    state.nativeCctvConnected = false;
    setCameraConnectFeedback(`CCTV 오류: ${detail.message || "프레임을 받지 못했습니다."}`, "error");
    return;
  }
  if (detail.status === "disconnected") {
    state.nativeCctvConnected = false;
  }
}

function renderDirectCameraStatus() {
  if (!state.directCameraUrl) return false;
  els.cameraConnectionChip.textContent = "카메라 링크됨";
  els.cameraConnectionChip.classList.remove("is-live", "is-error", "is-manual");
  els.cameraConnectionChip.classList.add("is-linked");
  els.cameraStatus.textContent = "직접 연결";
  if (els.cameraIntervalStatus) els.cameraIntervalStatus.textContent = "직접 보기";
  els.analysisStatus.textContent = "수동";
  els.objectStatus.textContent = "카메라 링크 연결됨 · 주차면 상태는 수동 관리 중";
  if (els.cameraOpenButton) {
    els.cameraOpenButton.hidden = false;
    const label = els.cameraOpenButton.querySelector?.("span");
    if (label) label.textContent = /^rtsps?:\/\//i.test(state.directCameraUrl) ? "VLC로 열기" : "영상 열기";
  }
  return true;
}

function directCameraLaunchUrl(url) {
  const normalized = normalizeCameraLink(url);
  const isRtsp = /^rtsps?:\/\//i.test(normalized);
  const isAppleMobile = /iPad|iPhone|iPod/i.test(navigator.userAgent || "");
  if (isRtsp && isAppleMobile) {
    return `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(normalized)}`;
  }
  return normalized;
}

function openDirectCameraLink() {
  if (!state.directCameraUrl) {
    setCameraConnectFeedback("먼저 카메라 링크를 연결해 주세요.", "error");
    return;
  }
  const launchUrl = directCameraLaunchUrl(state.directCameraUrl);
  if (/^rtsps?:\/\//i.test(state.directCameraUrl) || launchUrl.startsWith("vlc-x-callback:")) {
    window.location.assign(launchUrl);
    return;
  }
  window.open(launchUrl, "_blank", "noopener,noreferrer");
}

function setCameraConnectFeedback(message, status = "") {
  if (!els.cameraConnectFeedback) return;
  els.cameraConnectFeedback.textContent = message;
  els.cameraConnectFeedback.classList.toggle("is-error", status === "error");
  els.cameraConnectFeedback.classList.toggle("is-success", status === "success");
}

async function connectCameraFromAdmin(event) {
  event.preventDefault();
  let url = String(els.cameraRtspUrl?.value || "").trim();
  const token = String(els.cameraAdminToken?.value || "").trim();
  const endpoint = cameraApiUrl(url ? "/api/camera/configure" : "/api/camera/test");
  if (!endpoint && !url) {
    setCameraConnectFeedback("카메라 링크를 입력해 주세요.", "error");
    els.cameraRtspUrl?.focus();
    return;
  }
  if (url) {
    try {
      url = normalizeCameraLink(url);
    } catch (error) {
      setCameraConnectFeedback(error.message, "error");
      els.cameraRtspUrl?.focus();
      return;
    }
  }
  if (url && window.ParkViewNative?.supportsCctv) {
    await connectNativeCctvFromAdmin(url);
    return;
  }
  if (!endpoint) {
    saveDirectCameraLink(url);
    renderDirectCameraStatus();
    setCameraConnectFeedback("이 기기에 카메라 링크를 연결했습니다.", "success");
    return;
  }
  if (url && !/^rtsps?:\/\//i.test(url)) {
    setCameraConnectFeedback("자동 분석 서버에는 RTSP 링크만 연결할 수 있습니다.", "error");
    els.cameraRtspUrl?.focus();
    return;
  }
  if (token.length < 20) {
    setCameraConnectFeedback("로컬 서버의 관리자 토큰을 입력해 주세요.", "error");
    els.cameraAdminToken?.focus();
    return;
  }

  const label = els.cameraConnectButton?.querySelector("span");
  const previousLabel = label?.textContent || "연결 및 테스트";
  if (els.cameraConnectButton) els.cameraConnectButton.disabled = true;
  if (label) label.textContent = "연결 확인 중";
  setCameraConnectFeedback("RTSP 프레임을 확인하고 있습니다.");
  try {
    const floor = state.floors[state.floorIndex];
    const request = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    };
    if (url) {
      request.headers["Content-Type"] = "application/json";
      request.body = JSON.stringify({
        url,
        name: `${state.selectedLot?.name || "주차장"} CCTV`,
        floor_id: floor?.name || "B1"
      });
    }
    const response = await fetch(endpoint, request);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `카메라 서버 HTTP ${response.status}`);
    try {
      sessionStorage.setItem(CAMERA_ADMIN_TOKEN_SESSION, token);
    } catch (_error) {
      // Session storage can be unavailable in restricted web views.
    }
    els.cameraRtspUrl.value = "";
    const resolution = result.image?.width && result.image?.height
      ? `${result.image.width}×${result.image.height}`
      : "프레임 수신";
    setCameraConnectFeedback(`${resolution} 확인 완료 · ${result.floor_id || floor?.name || "B1"}`, "success");
    await refreshEdgeStatus();
  } catch (error) {
    setCameraConnectFeedback(`연결 실패: ${error.message}`, "error");
  } finally {
    if (els.cameraConnectButton) els.cameraConnectButton.disabled = false;
    if (label) label.textContent = previousLabel;
  }
}

async function connectNativeCctvFromAdmin(url) {
  const label = els.cameraConnectButton?.querySelector("span");
  const previousLabel = label?.textContent || "CCTV 직접 연결";
  if (els.cameraConnectButton) els.cameraConnectButton.disabled = true;
  if (label) label.textContent = "첫 프레임 확인 중";
  setCameraConnectFeedback("아이폰에서 CCTV에 직접 연결하고 있습니다.");
  try {
    const result = await window.ParkViewNative.connectCctv(url, { intervalMs: 2000 });
    state.nativeCctvConnected = true;
    els.cameraRtspUrl.value = "";
    setCameraConnectFeedback(
      `CCTV 직접 연결 완료 · ${result.channel || "채널 101"} · 2초마다 분석`,
      "success"
    );
    renderNativeCctvStatus();
  } catch (error) {
    state.nativeCctvConnected = false;
    setCameraConnectFeedback(`직접 연결 실패: ${error.message}`, "error");
  } finally {
    if (els.cameraConnectButton) els.cameraConnectButton.disabled = false;
    if (label) label.textContent = previousLabel;
  }
}

async function refreshEdgeStatus() {
  if (renderDeviceCameraStatus()) return;
  if (renderNativeCctvStatus()) return;
  if (isDirectCameraMode() && renderDirectCameraStatus()) return;
  try {
    const healthUrl = cameraApiUrl("/api/health");
    const resultUrl = cameraApiUrl("/api/result");
    if (!healthUrl || !resultUrl) throw new Error("로컬 카메라 서버가 연결되지 않았습니다");
    const [healthResponse, resultResponse] = await Promise.all([
      fetch(healthUrl, { cache: "no-store" }),
      fetch(resultUrl, { cache: "no-store" })
    ]);
    if (!healthResponse.ok) throw new Error(`분석 서버 HTTP ${healthResponse.status}`);

    const health = await healthResponse.json();
    const result = resultResponse.ok ? await resultResponse.json() : null;
    const cameraConnected = health.camera?.connected === true;
    const configured = health.camera?.configured === true;
    const manualMode = !cameraConnected;

    els.cameraConnectionChip.textContent = cameraConnected ? "CCTV 연결됨" : "수동 관리";
    els.cameraConnectionChip.classList.remove("is-linked");
    els.cameraConnectionChip.classList.toggle("is-live", cameraConnected);
    els.cameraConnectionChip.classList.remove("is-error");
    els.cameraConnectionChip.classList.toggle("is-manual", manualMode);
    els.cameraStatus.textContent = cameraConnected
      ? "정상"
      : configured ? "연결 대기" : "선택 연결";
    if (els.cameraIntervalStatus) {
      els.cameraIntervalStatus.textContent = `${health.analysis_interval_seconds || 30}초`;
    }

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
    els.cameraConnectionChip.classList.remove("is-linked");
    els.cameraConnectionChip.classList.remove("is-live");
    els.cameraConnectionChip.classList.remove("is-error");
    els.cameraConnectionChip.classList.add("is-manual");
    els.cameraStatus.textContent = "선택 연결";
    if (els.cameraIntervalStatus) els.cameraIntervalStatus.textContent = "해당 없음";
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
  if (screen !== "admin") {
    window.dispatchEvent(new Event("parkview:stop-device-camera"));
  }
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
  const max = els.userScreen?.clientHeight || window.innerHeight;
  const min = Math.min(max, Math.max(170, max * 0.22));
  const medium = clamp(max * 0.57, min, max);
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
  els.sheetHandle.setAttribute("aria-valuenow", String(Math.round(nextHeight / bounds.max * 100)));
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

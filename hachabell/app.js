import React, { useCallback, useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(React.createElement);
const config = window.HACHABELL_CONFIG || {};
const DEMO_ORIGIN = { lat: 37.5665, lng: 126.9780 };
const FAVORITES_KEY = "hachabell.favorites";
const ALERT_RANGES = [200, 400, 600, 1000];

const SAMPLE_PLACES = [
  { id: "city-hall", name: "서울시청", address: "서울 중구 세종대로 110", lat: 37.5663, lng: 126.9779 },
  { id: "gangnam", name: "강남역", address: "서울 강남구 강남대로 396", lat: 37.4979, lng: 127.0276 },
  { id: "hongdae", name: "홍대입구역", address: "서울 마포구 양화로 160", lat: 37.5572, lng: 126.9245 },
  { id: "jamsil", name: "잠실역", address: "서울 송파구 올림픽로 265", lat: 37.5133, lng: 127.1001 },
  { id: "seoul-station", name: "서울역", address: "서울 용산구 한강대로 405", lat: 37.5547, lng: 126.9707 }
];

let kakaoPromise;

function loadKakao() {
  if (window.kakao?.maps) return Promise.resolve(window.kakao);
  if (!config.kakaoJavaScriptKey) return Promise.reject(new Error("카카오 JavaScript 키가 설정되지 않았습니다."));
  if (kakaoPromise) return kakaoPromise;
  kakaoPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(config.kakaoJavaScriptKey)}&libraries=services&autoload=false`;
    script.async = true;
    script.onload = () => window.kakao.maps.load(() => resolve(window.kakao));
    script.onerror = () => reject(new Error("카카오맵 SDK를 불러오지 못했습니다."));
    document.head.appendChild(script);
  });
  return kakaoPromise;
}

function distanceBetween(a, b) {
  if (!a || !b) return 0;
  const earth = 6371000;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(earth * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)));
}

function formatDistance(meters) {
  if (!meters) return "거리 계산 중";
  return meters < 1000 ? `${meters}m` : `${(meters / 1000).toFixed(1)}km`;
}

function readFavorites() {
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
  } catch {
    return [];
  }
}

function Icon({ name, size = 18 }) {
  const paths = {
    arrow: "M5 12h14M13 6l6 6-6 6",
    bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
    bookmark: "M6 3h12v18l-6-4-6 4z",
    bus: "M5 17h14l1 2H4l1-2zM6 17V5c0-1.1 2.7-2 6-2s6 .9 6 2v12M7 8h10M8 13h.01M16 13h.01",
    check: "m5 12 4 4L19 6",
    chevron: "m9 18 6-6-6-6",
    compass: "m12 19 7-7-7-7-7 7 7 7zM12 12l2-2",
    location: "M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    map: "M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6zM9 3v15M15 6v15",
    pin: "M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0z",
    plus: "M12 5v14M5 12h14",
    search: "m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z",
    settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.42 1.42-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56V19.6h-2v-.08A1.7 1.7 0 0 0 12.36 18a1.7 1.7 0 0 0-1.88.34l-.06.06L9 16.98l.06-.06A1.7 1.7 0 0 0 9.4 15a1.7 1.7 0 0 0-1.56-1.04H7.6v-2h.24A1.7 1.7 0 0 0 9.4 11a1.7 1.7 0 0 0-.34-1.88L9 9.06l1.42-1.42.06.06A1.7 1.7 0 0 0 12.36 8a1.7 1.7 0 0 0 1.04-1.56V6.4h2v.08A1.7 1.7 0 0 0 16.44 8a1.7 1.7 0 0 0 1.88-.34l.06-.06 1.42 1.42-.06.06A1.7 1.7 0 0 0 19.4 11c.23.63.83 1.04 1.5 1.04h.5v2h-.5A1.7 1.7 0 0 0 19.4 15z",
    star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 7.5 14 3 9.6l6.2-.9L12 3z",
    train: "M6 3h12v13H6zM8 19l-2 2M16 19l2 2M6 8h12M9 13h.01M15 13h.01",
    walk: "M13 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM10 22l1-7 2-2 2 3 3 1M11 15l-3-3 2-5 4 2 2 3"
  };
  return html`<svg className="icon" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d=${paths[name] || paths.pin} /></svg>`;
}

function App() {
  const mapElement = useRef(null);
  const mapRef = useRef(null);
  const markerRefs = useRef([]);
  const lineRef = useRef(null);
  const watchRef = useRef(null);
  const searchTimer = useRef(null);
  const [activeTab, setActiveTab] = useState("route");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [destination, setDestination] = useState(null);
  const [currentPosition, setCurrentPosition] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapStatus, setMapStatus] = useState("카카오맵 연결 준비 중");
  const [locationStatus, setLocationStatus] = useState("위치 권한을 허용하면 현재 위치를 표시해요.");
  const [tracking, setTracking] = useState(false);
  const [alerted, setAlerted] = useState(false);
  const [alertRange, setAlertRange] = useState(400);
  const [favorites, setFavorites] = useState(readFavorites);
  const [notice, setNotice] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(true);

  const visualOrigin = currentPosition || DEMO_ORIGIN;
  const remainingDistance = destination ? distanceBetween(visualOrigin, destination) : 0;
  const routes = useMemo(() => {
    if (!destination) return [];
    const base = Math.max(14, Math.round((remainingDistance / 1000) * 8 + 12));
    return [
      { type: "추천", title: "가장 빠른 경로", vehicle: "지하철 + 도보", time: base, transfers: 1, fare: 1_400, color: "violet", icon: "train" },
      { type: "편안", title: "환승이 적은 경로", vehicle: "버스", time: base + 8, transfers: 0, fare: 1_500, color: "blue", icon: "bus" },
      { type: "저렴", title: "도보를 줄인 경로", vehicle: "버스 + 지하철", time: base + 14, transfers: 2, fare: 1_500, color: "orange", icon: "bus" }
    ];
  }, [destination, remainingDistance]);

  const saveFavorites = useCallback((next) => {
    setFavorites(next);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  }, []);

  const chooseDestination = useCallback((place) => {
    const normalized = {
      id: place.id || place.place_url || `${place.lat}-${place.lng}`,
      name: place.name || place.place_name,
      address: place.address || place.road_address_name || "주소 정보 없음",
      lat: Number(place.lat ?? place.y),
      lng: Number(place.lng ?? place.x)
    };
    setDestination(normalized);
    setQuery(normalized.name);
    setResults([]);
    setNotice(`${normalized.name}을(를) 목적지로 설정했어요.`);
    setActiveTab("route");
    setAlerted(false);
  }, []);

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationStatus("이 브라우저에서는 위치 기능을 사용할 수 없어요.");
      return;
    }
    setLocationStatus("현재 위치를 확인하고 있어요...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = { lat: position.coords.latitude, lng: position.coords.longitude };
        setCurrentPosition(next);
        setLocationStatus(`현재 위치 확인 완료 · 정확도 약 ${Math.round(position.coords.accuracy)}m`);
        if (mapRef.current && window.kakao?.maps) mapRef.current.setCenter(new window.kakao.maps.LatLng(next.lat, next.lng));
      },
      () => setLocationStatus("위치 권한을 확인하지 못했어요. 브라우저 설정에서 권한을 허용해 주세요."),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
    );
  }, []);

  const notifyReached = useCallback(() => {
    setAlerted(true);
    setNotice(`목적지 ${destination?.name || "근처"}에 도착했어요. 하차 준비를 해주세요.`);
    if (navigator.vibrate) navigator.vibrate([250, 120, 250]);
    if (soundEnabled) {
      try {
        const context = new (window.AudioContext || window.webkitAudioContext)();
        [0, 0.22, 0.44].forEach((delay, index) => {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.frequency.value = index === 1 ? 880 : 660;
          gain.gain.setValueAtTime(0.0001, context.currentTime + delay);
          gain.gain.exponentialRampToValueAtTime(0.2, context.currentTime + delay + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + delay + 0.16);
          oscillator.connect(gain).connect(context.destination);
          oscillator.start(context.currentTime + delay);
          oscillator.stop(context.currentTime + delay + 0.18);
        });
      } catch {
        // Audio is optional and may be blocked until the next user gesture.
      }
    }
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("하차벨 알림", { body: `${destination?.name || "목적지"}에 가까워졌어요.` });
    }
  }, [destination, soundEnabled]);

  useEffect(() => {
    let cancelled = false;
    loadKakao().then((kakao) => {
      if (cancelled || !mapElement.current) return;
      const map = new kakao.maps.Map(mapElement.current, {
        center: new kakao.maps.LatLng(DEMO_ORIGIN.lat, DEMO_ORIGIN.lng),
        level: 7,
        draggable: true,
        scrollwheel: true
      });
      mapRef.current = map;
      setMapReady(true);
      setMapStatus("카카오맵 연결됨");
    }).catch(() => setMapStatus("미리보기 지도 · 카카오 키 등록 후 실제 지도가 표시돼요"));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!mapReady || !window.kakao?.maps || !mapRef.current) return;
    const kakao = window.kakao;
    markerRefs.current.forEach((marker) => marker.setMap(null));
    markerRefs.current = [];
    if (currentPosition) {
      const marker = new kakao.maps.Marker({ position: new kakao.maps.LatLng(currentPosition.lat, currentPosition.lng), map: mapRef.current, title: "현재 위치" });
      markerRefs.current.push(marker);
    }
    if (destination) {
      const marker = new kakao.maps.Marker({ position: new kakao.maps.LatLng(destination.lat, destination.lng), map: mapRef.current, title: destination.name });
      markerRefs.current.push(marker);
      mapRef.current.panTo(marker.getPosition());
    }
    if (lineRef.current) lineRef.current.setMap(null);
    if (currentPosition && destination) {
      lineRef.current = new kakao.maps.Polyline({ path: [new kakao.maps.LatLng(currentPosition.lat, currentPosition.lng), new kakao.maps.LatLng(destination.lat, destination.lng)], strokeWeight: 4, strokeColor: "#5a63d8", strokeOpacity: 0.75, strokeStyle: "shortdash" });
      lineRef.current.setMap(mapRef.current);
    }
  }, [mapReady, currentPosition, destination]);

  useEffect(() => {
    clearTimeout(searchTimer.current);
    if (!query.trim() || destination?.name === query.trim()) {
      setResults([]);
      return undefined;
    }
    searchTimer.current = setTimeout(async () => {
      if (mapReady && window.kakao?.maps?.services) {
        const places = new window.kakao.maps.services.Places();
        places.keywordSearch(query.trim(), (data, status) => {
          if (status === window.kakao.maps.services.Status.OK) setResults(data.slice(0, 5));
          else setResults(SAMPLE_PLACES.filter((place) => place.name.includes(query.trim()) || place.address.includes(query.trim())));
        });
      } else {
        setResults(SAMPLE_PLACES.filter((place) => place.name.includes(query.trim()) || place.address.includes(query.trim())).slice(0, 5));
      }
    }, 320);
    return () => clearTimeout(searchTimer.current);
  }, [query, mapReady, destination]);

  useEffect(() => {
    if (!tracking) {
      if (watchRef.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
      return undefined;
    }
    if (!navigator.geolocation) return undefined;
    watchRef.current = navigator.geolocation.watchPosition((position) => {
      setCurrentPosition({ lat: position.coords.latitude, lng: position.coords.longitude });
      setLocationStatus(`이동 중 · 정확도 약 ${Math.round(position.coords.accuracy)}m`);
    }, () => setLocationStatus("위치 업데이트가 중단됐어요."), { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 });
    return () => { if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current); };
  }, [tracking]);

  useEffect(() => {
    if (tracking && destination && currentPosition && !alerted && remainingDistance <= alertRange) notifyReached();
  }, [tracking, destination, currentPosition, alerted, remainingDistance, alertRange, notifyReached]);

  const isFavorite = destination && favorites.some((item) => item.id === destination.id);
  const toggleFavorite = () => {
    if (!destination) return;
    saveFavorites(isFavorite ? favorites.filter((item) => item.id !== destination.id) : [...favorites, destination]);
  };
  const startTracking = async () => {
    if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
    if (!currentPosition) locate();
    setTracking(true);
    setAlerted(false);
    setActiveTab("tracking");
    setNotice("이동을 시작하면 목적지와의 거리를 계속 확인할게요.");
  };

  return html`
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><${Icon} name="bell" size=${19} /></span><div><strong>하차벨</strong><small>HachaBell</small></div></div>
        <div className="topbar-meta"><span className="status-dot"></span><span>1차 버전</span><button className="icon-button" title="설정"><${Icon} name="settings" size=${18} /></button></div>
      </header>
      <main className="workspace">
        <aside className="sidebar">
          <div className="intro"><p className="eyebrow">SMART TRANSIT</p><h1>내릴 곳을<br /><em>놓치지 않게</em></h1><p>목적지를 설정하고 이동을 시작하면 가까워졌을 때 알려드려요.</p></div>
          <div className="search-card">
            <label for="destination-search">목적지 설정</label>
            <div className="search-input-wrap"><${Icon} name="search" size=${18} /><input id="destination-search" value=${query} onInput=${(event) => setQuery(event.target.value)} placeholder="장소, 정류장, 역 검색" autocomplete="off" /></div>
            ${results.length > 0 && html`<div className="search-results">${results.map((place) => html`<button className="search-result" key=${place.id || place.place_url} onClick=${() => chooseDestination(place)}><span className="result-icon"><${Icon} name="pin" size=${16} /></span><span><strong>${place.name || place.place_name}</strong><small>${place.address || place.road_address_name || "주소 정보 없음"}</small></span><${Icon} name="chevron" size=${16} /></button>`)}</div>`}
            ${destination && html`<div className="selected-place"><span className="selected-pin"><${Icon} name="check" size=${16} /></span><span><small>선택한 목적지</small><strong>${destination.name}</strong></span><button className=${`favorite-button ${isFavorite ? "active" : ""}`} onClick=${toggleFavorite} title="즐겨찾기"><${Icon} name="star" size=${18} /></button></div>`}
            <button className="location-button" onClick=${locate}><${Icon} name="compass" size=${17} />${currentPosition ? "현재 위치 다시 확인" : "현재 위치 가져오기"}</button>
          </div>
          ${notice && html`<div className=${`notice ${alerted ? "alerted" : ""}`}><${Icon} name=${alerted ? "bell" : "check"} size=${17} /><span>${notice}</span></div>`}
          <nav className="side-nav"><button className=${activeTab === "route" ? "active" : ""} onClick=${() => setActiveTab("route")}><${Icon} name="map" size=${18} /><span>경로 찾기</span></button><button className=${activeTab === "tracking" ? "active" : ""} onClick=${() => setActiveTab("tracking")}><${Icon} name="bell" size=${18} /><span>하차 알림</span>${tracking && html`<i className="nav-live"></i>`}</button><button className=${activeTab === "favorites" ? "active" : ""} onClick=${() => setActiveTab("favorites")}><${Icon} name="bookmark" size=${18} /><span>즐겨찾기</span><b>${favorites.length}</b></button></nav>
          <div className="sidebar-footer"><span className="footer-line"></span><p>카카오맵 기반 길찾기<br />실시간 버스 도착 정보는 2차 연동 예정</p></div>
        </aside>
        <section className="content">
          <div className="map-card"><div ref=${mapElement} className="map-canvas"></div><div className="map-fallback-grid"></div><div className="map-status"><span className=${mapReady ? "ready-dot" : "soft-dot"}></span>${mapStatus}</div><div className="map-legend"><span><i className="legend-user"></i>현재 위치</span><span><i className="legend-destination"></i>목적지</span></div><button className="map-locate" onClick=${locate} title="현재 위치로 이동"><${Icon} name="compass" size=${19} /></button></div>
          ${activeTab === "route" && html`<section className="panel route-panel"><div className="panel-heading"><div><p className="eyebrow">ROUTE OPTIONS</p><h2>${destination ? `${destination.name}까지 추천 경로` : "목적지를 선택해 주세요"}</h2></div>${destination && html`<span className="distance-badge">${formatDistance(remainingDistance)}</span>`}</div>${destination ? html`<div className="route-list">${routes.map((route, index) => html`<button className=${`route-card ${index === 0 ? "recommended" : ""}`} key=${route.title}><span className=${`route-icon ${route.color}`}><${Icon} name=${route.icon} size=${20} /></span><span className="route-main"><span className="route-topline"><strong>${route.title}</strong>${index === 0 && html`<em>추천</em>`}</span><span className="route-vehicles">${route.vehicle} · 환승 ${route.transfers}회 · ${route.fare.toLocaleString()}원</span></span><span className="route-time"><strong>${route.time}<small>분</small></strong><${Icon} name="chevron" size=${17} /></span></button>`)}</div><div className="route-note"><${Icon} name="bus" size=${17} /><span>실시간 도착 예정 시간은 카카오 대중교통 API 연동 후 표시됩니다.</span></div>` : html`<div className="empty-state"><div className="empty-icon"><${Icon} name="pin" size=${25} /></div><h3>어디로 가시나요?</h3><p>왼쪽 검색창에서 목적지나 정류장을 검색하면<br />나에게 맞는 대중교통 경로를 보여드려요.</p><button onClick=${() => document.getElementById("destination-search")?.focus()}>목적지 검색하기 <${Icon} name="arrow" size=${16} /></button></div>`}</section>`}
          ${activeTab === "tracking" && html`<section className="panel tracking-panel"><div className="panel-heading"><div><p className="eyebrow">GET OFF ALERT</p><h2>하차 알림 설정</h2></div><span className=${`tracking-status ${tracking ? "on" : ""}`}><i></i>${tracking ? "알림 켜짐" : "대기 중"}</span></div><div className="tracking-destination"><span className="destination-icon"><${Icon} name="pin" size=${20} /></span><div><small>알림 목적지</small><strong>${destination?.name || "목적지를 먼저 선택해 주세요"}</strong><p>${destination?.address || "경로 찾기에서 목적지를 검색하세요."}</p></div></div><div className="alert-range"><div className="range-heading"><span>알림 거리</span><strong>${alertRange >= 1000 ? "1km" : `${alertRange}m`} 전</strong></div><div className="range-options">${ALERT_RANGES.map((range) => html`<button className=${alertRange === range ? "active" : ""} onClick=${() => setAlertRange(range)}>${range >= 1000 ? "1km" : `${range}m`}</button>`)}</div></div><div className="tracking-controls"><label className="toggle-row"><span><strong>소리 알림</strong><small>도착 시 알림음을 재생해요.</small></span><input type="checkbox" checked=${soundEnabled} onChange=${(event) => setSoundEnabled(event.target.checked)} /><i></i></label><button className=${`tracking-button ${tracking ? "stop" : ""}`} disabled=${!destination} onClick=${() => tracking ? setTracking(false) : startTracking()}><${Icon} name="bell" size=${18} />${tracking ? "하차 알림 끄기" : "하차 알림 시작"}</button></div>${!destination && html`<p className="inline-help">먼저 경로 찾기에서 목적지를 선택해 주세요.</p>`}</section>`}
          ${activeTab === "favorites" && html`<section className="panel favorites-panel"><div className="panel-heading"><div><p className="eyebrow">SAVED PLACES</p><h2>즐겨찾는 장소</h2></div><span className="distance-badge">${favorites.length}개</span></div>${favorites.length ? html`<div className="favorite-list">${favorites.map((place) => html`<button className="favorite-row" key=${place.id} onClick=${() => chooseDestination(place)}><span className="favorite-row-icon"><${Icon} name="bookmark" size=${17} /></span><span><strong>${place.name}</strong><small>${place.address}</small></span><${Icon} name="chevron" size=${17} /></button>`)}</div>` : html`<div className="empty-state compact"><div className="empty-icon"><${Icon} name="bookmark" size=${24} /></div><h3>아직 저장한 장소가 없어요</h3><p>목적지를 선택한 뒤 별표를 눌러 저장해 보세요.</p></div>`}</section>`}
        </section>
      </main>
      <footer className="mobile-footer"><button className=${activeTab === "route" ? "active" : ""} onClick=${() => setActiveTab("route")}><${Icon} name="map" size=${18} /><span>경로</span></button><button className=${activeTab === "tracking" ? "active" : ""} onClick=${() => setActiveTab("tracking")}><${Icon} name="bell" size=${18} /><span>알림</span></button><button className=${activeTab === "favorites" ? "active" : ""} onClick=${() => setActiveTab("favorites")}><${Icon} name="bookmark" size=${18} /><span>즐겨찾기</span></button></footer>
    </div>
  `;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);

(() => {
  "use strict";

  const STORAGE_KEY = "parkview.onboarding.v1";
  const PURPOSES = {
    search: ["목적지 주변 주차장", "검색 한 번으로,<br>주차가 한눈에."],
    availability: ["도착 전에 빈자리 확인", "어디가 비었는지,<br>미리 알고 출발해요."],
    filters: ["요금부터 운영시간까지", "나에게 맞는 주차장,<br>조건으로 좁혀보세요."],
    manage: ["주차장 운영도 ParkView", "주차장 찾기부터,<br>CCTV 관리까지."]
  };
  const STEPS = [
    { target: ".search-primary-row", title: "어디로 가시나요?", description: "장소나 주소를 검색하면 목적지 주변 주차장을 찾을 수 있어요. 마이크로 말해도 좋아요." },
    { target: ".quick-filter-row", title: "필요한 조건만 쏙", description: "빈자리, 무료, 운영 중인 곳을 골라보세요. 왼쪽 필터에서 요금과 주차장 유형도 설정할 수 있어요." },
    { target: "#mapLocateButton", title: "내 주변으로 바로 이동", description: "현재 위치 버튼을 누르면 내 주변 주차장으로 이동해요. 위치 권한을 허용하면 더 편리해요." },
    { target: "#menuButton", title: "즐겨찾기부터 주차장 관리까지", description: "메뉴에서 저장한 주차장과 CCTV 관리 화면을 열 수 있어요. 이 가이드도 언제든 다시 볼 수 있어요." }
  ];

  window.initializeParkViewOnboarding = ({ refreshIcons, prepareHome = () => {} } = {}) => {
    const root = document.querySelector("#onboarding");
    if (!root) return { whenFinished: Promise.resolve(), ready() {} };
    const node = (id) => root.querySelector(`#${id}`);
    const screens = [...document.querySelectorAll("#userScreen, #adminScreen")];
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let active = false;
    let appReady = false;
    let purpose = "search";
    let phase = "closed";
    let step = 0;
    let run = 0;
    let timeout;
    let resume;
    let previousFocus;
    let previousInert = [];
    let finished;
    const whenFinished = new Promise((resolve) => { finished = resolve; });

    function completed() {
      for (const name of ["localStorage", "sessionStorage"]) {
        try { if (window[name].getItem(STORAGE_KEY)) return true; } catch { /* Private browsing may deny storage. */ }
      }
      return false;
    }

    function cancelAnimation() {
      run += 1;
      window.clearTimeout(timeout);
      if (resume) { resume(false); resume = null; }
    }

    function pause(ms) {
      return new Promise((resolve) => {
        resume = resolve;
        timeout = window.setTimeout(() => { resume = null; resolve(true); }, ms);
      });
    }

    function setFocus(id) { node(id).focus({ preventScroll: true }); }

    function start(replay = false) {
      if (active) return;
      if (replay) prepareHome();
      active = true;
      previousFocus = document.activeElement;
      previousInert = screens.map((screen) => screen.inert);
      screens.forEach((screen) => { screen.inert = true; });
      root.hidden = false;
      root.classList.remove("is-tour");
      showChoices();
      refreshIcons?.();
    }

    function finish(skipped = false) {
      if (!active) return;
      cancelAnimation();
      active = false;
      phase = "closed";
      root.hidden = true;
      screens.forEach((screen, index) => { screen.inert = previousInert[index]; });
      const record = JSON.stringify({ completedAt: new Date().toISOString(), purpose, skipped });
      for (const name of ["localStorage", "sessionStorage"]) {
        try { window[name].setItem(STORAGE_KEY, record); } catch { /* Keep the app usable without browser storage. */ }
      }
      const target = previousFocus?.isConnected && !root.contains(previousFocus)
        && !previousFocus.closest?.('[aria-hidden="true"], [hidden]')
        && previousFocus !== document.body && previousFocus.getClientRects().length
        ? previousFocus : document.querySelector("#menuButton");
      // Do not focus the search field here: that would open search discovery behind permissions.
      if (target && target.id !== "searchInput") target.focus({ preventScroll: true });
      finished();
    }

    function showChoices() {
      cancelAnimation();
      phase = "choices";
      root.setAttribute("aria-labelledby", "onboardingTitle");
      node("onboardingChoice").hidden = false;
      node("onboardingDemo").hidden = true;
      node("onboardingTour").hidden = true;
      setFocus("onboardingTitle");
    }

    function showResults() {
      node("onboardingDemoStage").dataset.phase = "results";
      node("demoTypedSearch").textContent = "판교역";
      node("onboardingReplay").hidden = false;
      node("onboardingStart").hidden = false;
      node("onboardingAnimationProgress").hidden = true;
      node("onboardingAnimationStatus").textContent = purpose === "manage"
        ? "CCTV 연결과 주차면 설정은 홈 메뉴에서 할 수 있어요"
        : purpose === "availability" ? "빈자리 정보가 제공되는 주차장을 확인해 보세요"
          : purpose === "filters" ? "요금과 운영시간을 비교하고 골라보세요" : "주차장을 누르면 요금과 빈자리를 확인할 수 있어요";
      phase = "results";
    }

    async function playDemo(selected = purpose) {
      if (!PURPOSES[selected]) return;
      cancelAnimation();
      const currentRun = run;
      purpose = selected;
      phase = "demo";
      root.setAttribute("aria-labelledby", "onboardingDemoTitle");
      node("onboardingChoice").hidden = true;
      node("onboardingDemo").hidden = false;
      node("onboardingDemoEyebrow").textContent = PURPOSES[purpose][0];
      node("onboardingDemoTitle").innerHTML = PURPOSES[purpose][1];
      node("onboardingStart").hidden = true;
      node("onboardingReplay").hidden = true;
      node("onboardingAnimationProgress").hidden = false;
      node("onboardingDemoStage").dataset.phase = "idle";
      node("demoTypedSearch").textContent = "목적지 검색";
      node("onboardingAnimationStatus").textContent = "목적지를 검색하고 있어요";
      setFocus("onboardingDemoTitle");
      drawMap(node("onboardingMap"));
      if (motion.matches) { showResults(); return; }
      const wait = async (ms) => (await pause(ms)) && active && run === currentRun;
      if (!await wait(450)) return;
      node("onboardingDemoStage").dataset.phase = "typing";
      for (const word of ["판", "판교", "판교역"]) {
        node("demoTypedSearch").textContent = word;
        if (!await wait(340)) return;
      }
      node("onboardingDemoStage").dataset.phase = "suggesting";
      node("onboardingAnimationStatus").textContent = "연관 검색에서 목적지를 선택해요";
      if (!await wait(1250)) return;
      node("onboardingDemoStage").dataset.phase = "selecting";
      if (!await wait(700)) return;
      node("onboardingDemoStage").dataset.phase = "locating";
      node("onboardingAnimationStatus").textContent = "주변 주차장을 찾았어요";
      if (!await wait(1300)) return;
      showResults();
    }

    function beginTour() {
      if (!active || phase !== "results") return;
      cancelAnimation();
      phase = "tour";
      step = 0;
      root.classList.add("is-tour");
      node("onboardingTour").hidden = false;
      root.setAttribute("aria-labelledby", "tourTitle");
      renderStep();
    }

    function renderStep() {
      const item = STEPS[step];
      node("tourTitle").textContent = item.title;
      node("tourDescription").textContent = item.description;
      node("tourStepCount").textContent = `${step + 1} / ${STEPS.length}`;
      node("tourDots").innerHTML = STEPS.map((_, index) => `<span${index === step ? ' class="active"' : ""}></span>`).join("");
      node("tourNext").innerHTML = `${step === STEPS.length - 1 ? "시작하기" : "다음"}<i data-lucide="arrow-right"></i>`;
      refreshIcons?.();
      positionTip();
      setFocus("tourTitle");
    }

    function positionTip() {
      if (phase !== "tour") return;
      const frame = root.getBoundingClientRect();
      const target = document.querySelector(STEPS[step].target);
      const rect = target?.getBoundingClientRect();
      const hasTarget = rect && rect.width > 0 && rect.height > 0;
      const spot = node("tourSpotlight");
      const tip = node("tourTip");
      const padding = 5;
      const left = hasTarget ? Math.max(4, rect.left - frame.left - padding) : 12;
      const top = hasTarget ? Math.max(4, rect.top - frame.top - padding) : 12;
      const right = hasTarget ? Math.min(frame.width - 4, rect.right - frame.left + padding) : frame.width - 12;
      const bottom = hasTarget ? Math.min(frame.height - 4, rect.bottom - frame.top + padding) : 64;
      Object.assign(spot.style, { left: `${left}px`, top: `${top}px`, width: `${Math.max(0, right - left)}px`, height: `${Math.max(0, bottom - top)}px` });
      tip.style.width = `${Math.min(330, frame.width - 32)}px`;
      const height = tip.getBoundingClientRect().height;
      const below = bottom + height + 22 <= frame.height - 16;
      const tipLeft = Math.max(16, Math.min((left + right - tip.offsetWidth) / 2, frame.width - tip.offsetWidth - 16));
      const tipTop = below ? bottom + 18 : Math.max(16, top - height - 18);
      Object.assign(tip.style, { left: `${tipLeft}px`, top: `${tipTop}px` });
      tip.dataset.placement = below ? "below" : "above";
      tip.style.setProperty("--arrow-left", `${Math.max(24, Math.min((left + right) / 2 - tipLeft, tip.offsetWidth - 24))}px`);
    }

    node("onboardingSkip").addEventListener("click", () => finish(true));
    node("tourSkip").addEventListener("click", () => finish(true));
    node("onboardingHome").addEventListener("click", (event) => { event.preventDefault(); showChoices(); });
    node("onboardingBack").addEventListener("click", showChoices);
    node("onboardingReplay").addEventListener("click", () => playDemo());
    node("onboardingStart").addEventListener("click", beginTour);
    node("tourNext").addEventListener("click", () => {
      if (step < STEPS.length - 1) { step += 1; renderStep(); } else finish();
    });
    root.querySelectorAll("[data-onboarding-purpose]").forEach((button) => {
      button.addEventListener("click", () => playDemo(button.dataset.onboardingPurpose));
    });
    document.querySelector("#menuTutorial")?.addEventListener("click", () => start(true));
    document.addEventListener("keydown", (event) => {
      if (!active) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); finish(true); return; }
      if (event.key !== "Tab") return;
      const buttons = [...root.querySelectorAll("button, a[href]")].filter((button) => !button.disabled && button.getClientRects().length);
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || !buttons.includes(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !buttons.includes(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }, true);
    window.addEventListener("resize", positionTip);
    window.visualViewport?.addEventListener("resize", positionTip);
    motion.addEventListener?.("change", () => {
      if (motion.matches && phase === "demo") { cancelAnimation(); showResults(); }
    });

    const api = { whenFinished, ready() { appReady = true; }, replay() { if (appReady) start(true); } };
    window.ParkViewOnboarding = api;
    if (/^#cctv=/.test(window.location.hash) || completed()) finished();
    else start();
    return api;
  };

  function drawMap(canvas) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#edf0ec";
    ctx.fillRect(0, 0, 520, 760);
    ctx.fillStyle = "#cde2cf";
    ctx.fillRect(8, 320, 100, 180);
    ctx.fillRect(360, 70, 150, 115);
    ctx.fillStyle = "#dde2dc";
    for (const [x, y, w, h] of [[18, 35, 100, 100], [158, 28, 130, 85], [155, 170, 125, 95], [335, 240, 145, 95], [160, 325, 115, 150], [330, 390, 130, 95], [15, 555, 105, 110], [165, 535, 125, 120], [350, 560, 145, 90]]) {
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "#d4dad3"; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
    }
    ctx.lineCap = "round";
    const roads = [[[140, -40], [125, 820]], [[310, -40], [325, 820]], [[-30, 150], [550, 210]], [[-30, 515], [550, 510]]];
    for (const points of roads) {
      ctx.beginPath(); ctx.moveTo(...points[0]); ctx.lineTo(...points[1]);
      ctx.strokeStyle = "#d8ddd6"; ctx.lineWidth = 37; ctx.stroke();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 30; ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(-40, 285); ctx.lineTo(560, 352);
    ctx.strokeStyle = "#e4d5a0"; ctx.lineWidth = 50; ctx.stroke();
    ctx.strokeStyle = "#fff2c7"; ctx.lineWidth = 44; ctx.stroke();
    ctx.fillStyle = "#89968a"; ctx.font = "18px sans-serif";
    ctx.fillText("공원", 34, 416);
    ctx.fillStyle = "#969c98"; ctx.font = "16px sans-serif";
    ctx.save(); ctx.translate(338, 445); ctx.rotate(Math.PI / 2); ctx.fillText("판교역로", 0, 0); ctx.restore();
  }
})();

# ParkView

ParkView는 CCTV 영상의 차량을 감지해 주차 칸 점유 상태를 갱신하고, 웹 지도와 2D 도면에 결과를 표시하는 프로토타입입니다.

## 구성

- `server.py`: 정적 웹 서버, YOLO 분석, Firebase 전송, Gemini 프록시
- `app.js`: 사용자 지도, 주차장 상세 화면, 관리자 등록 화면
- `calibrate.html`: 카메라 ROI와 원근 보정 좌표 등록
- `models/`: YOLO 모델 파일

## 환경변수

저장소에는 API 키를 커밋하지 않습니다. `.env.example`을 참고해 프로젝트 루트에 `.env`를 만들고 값을 입력하세요.

```dotenv
KAKAO_JAVASCRIPT_KEY=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash
PARKVIEW_ADMIN_TOKEN=CHANGE_THIS_TO_A_LONG_RANDOM_VALUE
```

카카오 지도 JavaScript 키는 브라우저 SDK가 런타임에 사용하므로 사용자에게 보일 수 있습니다. 카카오디벨로퍼스의 JavaScript SDK 도메인에 로컬 실행 주소 `http://localhost:5180`과 실제 배포 도메인을 등록해 사용 범위를 제한하세요. Gemini, Firebase 인증 토큰과 관리자 토큰은 서버에서만 사용합니다.

## 실행

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 server.py --host 0.0.0.0 --port 5180
```

브라우저에서 `http://localhost:5180/?v=97`을 엽니다. 단순 정적 서버를 사용하면 `/api/public-config`와 AI 프록시가 없으므로 반드시 `server.py`로 실행해야 합니다.

## 모바일 앱

웹 브라우저는 사용자가 운영체제 설정에서 차단한 위치·마이크 권한을 앱 버튼으로 다시 켤 수 없습니다. `ios/`와 `android/` 프로젝트는 Capacitor 네이티브 권한 API를 사용하므로, 설치형 앱에서는 `현재 위치 사용`과 음성 검색 버튼이 운영체제 권한 창을 직접 요청합니다.

```bash
npm install
npm run cap:sync
npm run cap:ios
# 또는
npm run cap:android
```

- iOS: Xcode에서 개발 팀과 번들 서명을 선택한 뒤 실제 iPhone에서 실행합니다.
- Android: Android Studio에서 프로젝트를 열거나, Android Studio 내장 JDK로 `android/gradlew assembleDebug`를 실행합니다.
- 카카오디벨로퍼스 JavaScript SDK 사이트 도메인에는 웹 배포 주소와 네이티브 WebView 주소 `https://localhost`를 등록합니다.
- 네이티브 앱이 외부 분석 서버를 사용할 경우 `.env`의 `PARKVIEW_EDGE_API_BASE_URL`에 HTTPS 주소를 입력한 뒤 `npm run cap:sync`를 다시 실행합니다.
- `.env` 값은 `npm run build:web` 시 `dist/config.js`에 반영되므로 API 비밀키를 넣으면 안 됩니다. 카카오 JavaScript 키처럼 공개 클라이언트 키만 허용 도메인으로 제한해 사용합니다.

## GitHub Pages

1. 저장소의 `Settings > Secrets and variables > Actions`에
   `KAKAO_JAVASCRIPT_KEY`를 추가합니다.
2. `Settings > Pages > Source`를 `GitHub Actions`로 변경합니다.
3. `main`에 push하면 `.github/workflows/pages.yml`이 정적 앱을 배포합니다.

Pages에서는 카카오 지도와 정적 UI만 동작합니다. Python 분석 API와
Gemini 프록시는 별도 HTTPS 백엔드 주소를 `edgeApiBaseUrl`에 지정해야 합니다.

## 테스트

```bash
python3 -m unittest discover -s tests -v
```

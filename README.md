# ParkView

ParkView는 기기 카메라 또는 설치형 CCTV의 YOLO 객체 감지 결과를 주차면 좌표와 매칭하고, 웹 지도와 2D 도면에 점유 정보를 표시하는 프로토타입입니다.

## 구성

- `server.py`: 정적 웹 서버, YOLO 분석, Firebase 전송, Gemini 프록시
- `app.js`: 사용자 지도, 주차장 상세 화면, 관리자 등록 화면
- `camera-analysis.js`: 관리 화면 안에서 실행되는 CCTV YOLO 객체 분석
- `camera-analysis-core.js`: ONNX YOLO 전처리, 좌표 복원, 중복 박스 제거
- `calibrate.html`: 카메라 ROI와 원근 보정 좌표 등록
- `models/`: YOLO 모델 파일

브라우저 분석은 COCO 객체 클래스가 포함된 `models/yolov5su.onnx`, 현장 분석 서버는 같은 모델의 PyTorch 원본인 `models/yolov5su.pt`를 사용합니다. 클래스와 관계없이 YOLO 객체 중심이 등록된 주차면 안에 있으면 점유로 판정합니다.

## 환경변수

저장소에는 API 키를 커밋하지 않습니다. `.env.example`을 참고해 프로젝트 루트에 `.env`를 만들고 값을 입력하세요.

```dotenv
KAKAO_JAVASCRIPT_KEY=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.7-flash
GEMINI_FALLBACK_MODELS=gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite
GEMINI_RETRY_ATTEMPTS=2
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

브라우저에서 CCTV가 연결된 PC의 `http://localhost:5180/?v=97` 또는 같은 네트워크 기기의 `http://PC의-LAN-IP:5180`을 엽니다. GitHub Pages는 HTTPS에서 사설 HTTP RTSP 서버를 호출할 수 없으므로 CCTV 자동 분석에는 사용할 수 없습니다. 단순 정적 서버를 사용하면 `/api/public-config`와 AI 프록시가 없으므로 반드시 `server.py`로 실행해야 합니다.

GitHub Pages에서 CCTV를 보려면 `server.py`를 실행한 PC 앞에 Cloudflare Tunnel 같은 공개 HTTPS 중계를 구성하고, 저장소 Actions Secret `PARKVIEW_CAMERA_API_BASE_URL`에 그 HTTPS 주소를 등록해야 합니다. RTSP 주소 자체는 Pages에 넣지 않습니다.

현재 Localtunnel 주소를 복구할 때는 CCTV와 같은 네트워크에 있는 Mac에서 두 터미널을 계속 실행합니다.

Mac에서는 `start-parkview-public.command`를 실행하면 서버와 터널을 함께 시작하고, 터널이 끊겼을 때 자동으로 재연결합니다.

```bash
# 터미널 1: 공개 API 전용 서버 (웹 화면은 GitHub Pages에서 엽니다)
PARKVIEW_PUBLIC_RELAY=true PARKVIEW_DEBUG=false python3 server.py --host 127.0.0.1 --port 5180
# 터미널 2: 기존 Pages 설정과 같은 주소 요청
npx --yes localtunnel --port 5180 --subdomain odd-areas-move --local-host 127.0.0.1
```

출력된 주소가 `https://odd-areas-move.loca.lt`인지 확인합니다. 다른 주소가 할당되면 Pages의 `PARKVIEW_CAMERA_API_BASE_URL`도 변경하고 재배포해야 합니다. Mac이 잠들거나 서버/터널이 종료되면 연결이 끊어집니다. 공개 모드는 프로젝트 파일과 저장된 캡처를 제공하지 않으며, 영상·설정 요청에는 관리자 토큰이 필요합니다. 상태·분석 결과 API는 공개됩니다.

`503`은 터널 또는 현장 서버 연결 실패, `511`은 Localtunnel 안내 페이지 응답입니다. 웹의 CCTV API 요청에는 `bypass-tunnel-reminder` 헤더가 필요하고, 서버의 OPTIONS 응답에는 허용된 Origin 헤더가 정확히 한 번만 있어야 합니다.

### 현장 카메라 분석

`주차장 관리 > 등록된 주차장 > 현장 분석 > 기기 카메라 연결`을 누르면 휴대폰, 태블릿, 노트북 카메라 권한을 즉시 요청하고 분석을 시작합니다. 영상은 서버로 전송하지 않고 ONNX Runtime Web과 학습된 YOLO 모델로 기기 안에서 처리합니다. 이 방식에는 RTSP 주소, VLC, 관리자 토큰, 별도 중계 컴퓨터가 필요하지 않습니다. 같은 관리 화면에서 사진과 영상 파일도 선택할 수 있습니다.

카메라 연결을 처음 누를 때 약 35MB의 모델과 WebAssembly 실행 파일을 내려받습니다. 이후 파일은 서비스 워커 캐시에 저장됩니다. 웹에서는 HTTPS로 배포된 GitHub Pages에서 카메라 권한이 동작하며, iOS와 Android 설치 앱에는 카메라 권한 설명이 포함되어 있습니다.

고정 CCTV로 주차 가능 여부를 표시하려면 관리 화면의 `CCTV 주차면 등록`에서 현재 주차장 도면과 같은 순서로 각 주차면의 네 모서리를 지정해야 합니다. YOLO가 인식한 어떤 객체든 객체 중심이 등록된 주차면 안에 있으면 주차 중으로 판정하고, 빈 상태가 연속으로 확인된 뒤에만 주차 가능으로 바꿉니다. 카메라 위치나 화각을 변경하면 주차면을 다시 등록해야 합니다.

### 설치형 CCTV 연결

iPhone 설치 앱에서는 `주차장 관리 > 등록된 주차장 > 현장 분석 > 고정 CCTV 설정`에 기존 RTSP 주소를 입력하고 `CCTV 직접 연결`을 누릅니다. 앱은 RTSP 주소의 호스트, 계정, 채널 번호를 이용해 Hikvision ISAPI 사진 채널에 직접 접속하고 2초마다 새 프레임을 기기 내 YOLO로 분석합니다. 주소와 비밀번호는 앱 메모리에만 유지되며 화면을 나가거나 분석을 중지하면 삭제됩니다.

예를 들어 `rtsp://USER:PASSWORD@192.168.0.100:554/Streaming/Channels/101`은 iPhone 내부에서 `http://192.168.0.100:80/ISAPI/Streaming/channels/101/picture`로 변환됩니다. iPhone과 CCTV는 같은 Wi-Fi에 있어야 하며, 카메라에서 HTTP/ISAPI 스냅샷과 해당 계정의 조회 권한이 활성화되어 있어야 합니다. 이 직접 연결 기능은 현재 iPhone 앱에서 지원하고 GitHub Pages 웹사이트에서는 지원하지 않습니다.

RTSP 주소는 저장소에 커밋하지 말고 `.env`의 `PARKVIEW_CAMERA_URL`에만 입력합니다. 서버는 30초마다 새 프레임을 열어 분석하므로 연결이 끊겼다가 복구되어도 다음 주기에 다시 연결합니다.

관리자 화면의 `현장 분석 > 고정 CCTV 설정`은 RTSP를 지원하는 설치형 장비를 위한 보조 연결 방식입니다. RTSP 주소와 `PARKVIEW_ADMIN_TOKEN`을 입력하면 주소는 연결 테스트가 성공한 뒤 현장 서버 메모리에만 보관되며 브라우저 저장소, GitHub Pages, Render에는 저장하거나 전송하지 않습니다. 이 설정은 `server.py`로 띄운 현장 앱 또는 별도로 지정한 신뢰할 수 있는 카메라 API 서버에서만 동작합니다.

카메라 API 서버를 지정하지 않은 GitHub Pages에서는 관리자 토큰 입력란 대신 카메라 링크 하나만 표시합니다. 이 직접 연결 모드는 RTSP/HTTP(S) 링크를 현재 탭 세션에만 보관하며, iPhone의 RTSP 링크는 `VLC로 열기` 버튼으로 VLC에 전달합니다. 브라우저에서 RTSP를 분석하지 않으므로 이 모드의 주차면 상태는 수동으로 관리하며, 자동 점유 분석에는 위 현장 서버 구성이 필요합니다.

```bash
curl -X POST http://127.0.0.1:5180/api/camera/test \
  -H "Authorization: Bearer $PARKVIEW_ADMIN_TOKEN"
```

연결에 성공하면 `debug/latest_capture.jpg`가 저장됩니다. `/api/health`의 `camera` 항목에서 마지막 연결 시각, 연속 실패 횟수, 해상도와 화질 지표를 확인할 수 있습니다. 이 테스트는 YOLO와 Firebase를 실행하지 않으므로 CCTV 연결 문제를 분석 문제와 분리해 확인할 수 있습니다.

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
- 권한을 처음 요청할 때는 운영체제 권한 창이 열리고, 이미 차단된 권한은 같은 버튼이 ParkView 앱 설정 화면을 엽니다. 설정에서 허용한 뒤 앱으로 돌아오면 요청을 이어서 처리합니다.
- `.env` 값은 `npm run build:web` 시 `dist/config.js`에 반영되므로 API 비밀키를 넣으면 안 됩니다. 카카오 JavaScript 키처럼 공개 클라이언트 키만 허용 도메인으로 제한해 사용합니다.

## GitHub Pages

1. 저장소의 `Settings > Secrets and variables > Actions`에
   `KAKAO_JAVASCRIPT_KEY`를 추가합니다.
2. `Settings > Pages > Source`를 `GitHub Actions`로 변경합니다.
3. `main`에 push하면 `.github/workflows/pages.yml`이 정적 앱을 배포합니다.

### AI 도면 API 배포

`render.yaml`은 도면 생성 전용 `edge_api.py`만 배포하므로 CCTV/YOLO 서버보다
가볍습니다.

1. `https://render.com/deploy?repo=https://github.com/jaden70749/ParkView`에서
   Blueprint를 생성합니다.
2. 생성 화면의 `GEMINI_API_KEY`에 서버용 키를 입력합니다.
3. 배포 후 발급된 `https://...onrender.com` 주소를 GitHub 저장소의
   `Settings > Secrets and variables > Actions > Variables`에
   `PARKVIEW_EDGE_API_BASE_URL` 이름으로 추가합니다.
4. Pages 워크플로를 다시 실행하거나 `main`에 새 커밋을 push합니다.

브라우저에는 분석 서버 주소만 전달되며 Gemini 키는 Render 환경변수에만
남습니다. API는 `PARKVIEW_ALLOWED_ORIGINS`에 등록한 ParkView 웹 주소의 요청만
허용하고 호출 횟수와 요청 크기를 제한합니다.

## 테스트

```bash
python3 -m unittest discover -s tests -v
```

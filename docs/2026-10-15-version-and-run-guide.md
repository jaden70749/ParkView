# 10/15 코드 버전·실행·자료 공유 안내

기준일: 2026-10-15 (한국 시간). 오늘 업무 1번의 공유 자료입니다.
코드와 화면 배포가 확인된 상태와 실제 CCTV 현장 시험 결과를 구분해서 기록합니다.

## 1. 공유할 링크와 고정 버전

| 자료 | 공유 링크 | 10/15 확인 결과 |
| --- | --- | --- |
| 최신 웹 화면 | [ParkView GitHub Pages](https://jaden70749.github.io/ParkView/) | HTTP 200, 최신 화면 자산 확인 |
| 개인 저장소 고정 코드 | [5d227bb](https://github.com/jaden70749/ParkView/tree/5d227bb04b2c58c64a86c084bb098d31aeed5a67) | 원격 업로드 확인 |
| 학교 저장소 고정 코드 | [develop의 c293ad5](https://github.com/WayMakerSchool/2026-ParkView-Azas/tree/c293ad5d3ea6c5f30774ad4deffd97846f7d49ed) | 원격 업로드 확인 |
| 웹 배포 실행 기록 | [GitHub Actions 성공 기록](https://github.com/jaden70749/ParkView/actions/runs/38684338740) | completed / success |
| 학교 Vercel 웹 화면 | [학교 배포 주소](https://2026-park-view-azas.vercel.app/) | HTTP 200이지만 이전 UI 제공. 최신 버전 검토 링크로 사용하지 않음 |

개인·학교 저장소의 커밋 번호는 서로 다릅니다. 학교 저장소는 별도 이력을 가지며 학교 README와 `hardware/` 폴더를 유지했습니다.
이후 문서를 추가해 브랜치의 최신 커밋이 달라지더라도 위 링크는 오늘 검토할 기능 버전을 고정합니다.

### 최신 화면 구별

- 검색창을 누르면 주변 탐색, 내 장소, 즐겨찾기, 최근 검색이 나타납니다.
- 음식점·카페 같은 카테고리는 긴 검색 결과 목록 대신 지도 핀으로 표시하도록 구현했습니다.
- 관리자 화면은 `CCTV 분석 → 분석 시작 / CCTV 설정`으로 정리되어 있습니다.
- 확인한 화면 자산 버전: `styles.css?v=119`, `app.js?v=155`, `search-discovery.js?v=2`.

## 2. 지금 확인된 범위

| 항목 | 상태 | 근거 또는 제한 |
| --- | --- | --- |
| 웹 코드와 배포 | 확인 완료 | 위 커밋과 Actions 링크 |
| 웹 자동 테스트 | 65개 통과 | 해당 코드에서 `npm run test:web` 실행 결과 |
| 서버 자동 테스트 | 29개 통과 | 해당 코드에서 `python3 -m unittest discover -s tests -p test_server.py` 실행 결과 |
| 모바일 탐색 패널 | 확인 완료 | 브라우저에서 카테고리 선택, 목록 숨김, 가로 넘침 없음 확인 |
| 카테고리 지도 핀의 실제 서비스 표시 | 현장 재확인 필요 | 핀 생성·전환 테스트는 통과. 로컬 브라우저에서는 카카오 SDK 연결이 실패해 실제 카카오 지도 위 표시는 미확인 |
| 로컬 CCTV 서버 | 실행 중 응답 확인 | `/api/health`: ready=true, 등록 22면, 분석 주기 5초 |
| CCTV 영상 연결 | 미연결 | 같은 응답에서 camera.connected=false, 분석 오류 있음 |
| 기존 공개 CCTV 터널 | 연결 불가 | `/api/health` 요청에 HTTP 503 |
| 실제 차량 진입·이탈 감지 | 이번 자료에서는 미검증 | 업무 2번 현장 시험으로 확인할 항목 |

자동 테스트 통과나 웹 HTTP 200만으로 실제 CCTV 감지가 성공했다고 판단하지 않습니다.
현재 공유 가능한 것은 코드·UI 버전과 실행 절차이며, CCTV 현장 동작은 재연결 후 확인해야 합니다.

## 3. 다른 학생이 웹 화면만 확인하기

1. [최신 웹 링크](https://jaden70749.github.io/ParkView/)를 엽니다.
2. 검색창을 눌러 탐색 화면이 열리는지 확인합니다.
3. 검색 또는 카테고리 선택을 해 보고, 결과와 오류 메시지를 기록합니다.
4. 이전 UI가 보이면 새로고침합니다. 계속 이전 화면이면 시크릿 창에서 같은 링크를 엽니다.
5. CCTV는 현장 컴퓨터·카메라·중계 연결이 켜져 있어야 합니다. 웹 접속 성공과 CCTV 연결 성공을 따로 기록합니다.

집·회사/학교와 최근 검색은 각 브라우저에 저장됩니다. 다른 학생 브라우저에 동일한 내 장소가 나타날 필요는 없습니다.

## 4. 고정 코드로 로컬 실행하기

### 준비

- Python 3와 Node.js/npm이 설치된 컴퓨터를 사용합니다. 웹 CI는 Node.js 22를 사용합니다.
- CCTV를 실행할 컴퓨터는 카메라와 같은 네트워크에 있어야 합니다.
- 담당자가 카카오 JavaScript 키, CCTV 접속 정보, 관리자 토큰을 해당 컴퓨터에 설정합니다.
- API 키·관리자 토큰·CCTV 비밀번호는 공유 문서나 저장소에 쓰지 않습니다.

### A. 학교 저장소에서 코드 받기

새 폴더에서 실행합니다. 이미 작업 중인 폴더에서 버전을 바꾸지 않습니다.

```bash
git clone --branch develop https://github.com/WayMakerSchool/2026-ParkView-Azas.git ParkView-review
cd ParkView-review
git switch --detach c293ad5d3ea6c5f30774ad4deffd97846f7d49ed
npm ci
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

웹과 현장 서버의 실행 위치는 저장소 루트입니다. `hardware/`는 별도로 보관된 하드웨어 코드입니다.

### B. 현장 컴퓨터 설정

`.env.example`을 참고해 루트에 `.env`를 준비합니다. Raspberry Pi 예제의 `/opt`·`/var/lib` 경로를 그대로 사용하지 말고, 이 실행 폴더에 맞춥니다.

```dotenv
KAKAO_JAVASCRIPT_KEY=담당자가_설정
PARKVIEW_CAMERA_URL=rtsp://USERNAME:PASSWORD@CAMERA_IP:554/Streaming/Channels/101
PARKVIEW_ADMIN_TOKEN=담당자가_정한_관리자_토큰
PARKVIEW_MODEL_PATH=./models/yolov5su.pt
PARKVIEW_REGIONS_PATH=./parking_regions.json
PARKVIEW_FLOOR_ID=1F
PARKVIEW_ANALYSIS_INTERVAL=5
PARKVIEW_DEBUG=false
PARKVIEW_PUBLIC_RELAY=false
PARKVIEW_ALLOWED_ORIGINS=https://jaden70749.github.io,http://localhost:5180,http://127.0.0.1:5180
```

위 값은 입력 양식입니다. 카메라 주소·층·분석 주기는 실제 시험할 현장에 맞춰 정하고, 시험 도중에는 변경하지 않습니다.
카카오 키의 허용 도메인에는 실행할 `http://localhost:5180` 및 실제 배포 출처가 등록되어 있어야 합니다.
AI 도면 생성까지 사용할 때는 서버용 `GEMINI_API_KEY`도 별도로 필요합니다.

### C. 현장 서버 실행

```bash
source .venv/bin/activate
python server.py --host 127.0.0.1 --port 5180
```

브라우저에서 `http://localhost:5180/`을 엽니다. 해당 터미널은 실행하는 동안 계속 열어 둡니다.

### D. 카메라 연결과 좌표 확인

1. 메뉴에서 `주차장 관리`를 열고 시험할 주차장을 선택합니다.
2. `현장 분석 → CCTV 분석 → CCTV 설정`을 엽니다.
3. 필요한 경우 `연결 및 불러오기 옵션`에서 RTSP 링크와 관리자 토큰을 입력하고 `카메라 연결`을 누릅니다.
4. `현재 CCTV 불러오기`로 실제 CCTV 사진이 들어오는지 확인합니다.
5. 해당 주차장·층의 저장 좌표를 불러와 실제 주차칸 위치와 번호가 일치하는지 확인합니다.
6. 좌표를 새로 만드는 경우 감지 영역 지정, 자동 감지, 결과 적용, 저장 순서로 진행합니다.
7. 운영 관리로 돌아와 `분석 시작`을 누릅니다. CCTV 영상과 주차면 상태가 실제로 갱신되는지 확인합니다.

이전에 저장한 카메라 설정 파일이 있으면 `.env`의 카메라 URL보다 우선 적용될 수 있습니다.
주소가 달라졌다면 위 설정 화면에서 다시 연결해 저장합니다. 파일명은 `.parkview-camera-settings.json`이며 공개하지 않습니다.

## 5. 배포 웹에서 현장 CCTV에 연결할 때

로컬 실행과 외부 공개 중계는 별도입니다. 현재 `start-parkview-public.command`는 로컬 서버만 시작하며, 터널까지 시작하지 않습니다.

기존 로컬 서버를 종료하고 아래 두 터미널을 사용합니다. 이미 실행 중인 5180 포트 서버와 중복 실행하지 않습니다.

터미널 1: 공개 API 모드

```bash
source .venv/bin/activate
PARKVIEW_PUBLIC_RELAY=true PARKVIEW_DEBUG=false python server.py --host 127.0.0.1 --port 5180
```

터미널 2: HTTPS 중계

```bash
node scripts/run-public-tunnel.mjs
```

이 터널 스크립트는 `https://odd-areas-move.loca.lt` 주소를 요청하고 CORS 사전 요청을 검사합니다.
터미널에 `Public CCTV API:`가 표시되는지 확인합니다. 주소를 확보하지 못하면 연결 완료로 기록하지 않습니다.
배포 사이트가 사용하는 `cameraApiBaseUrl`과 중계 주소가 일치해야 합니다. 주소 변경 시 배포 설정 변경이 필요합니다.
외부 사이트는 [최신 웹 링크](https://jaden70749.github.io/ParkView/)로 열고, 로컬 설정 UI는 공개 API 모드에서 제공되지 않습니다.
컴퓨터가 잠들거나 서버·터널을 종료하면 중계 연결도 끊깁니다.

### 연결 확인

```bash
curl http://127.0.0.1:5180/api/health
curl -H 'bypass-tunnel-reminder: true' https://odd-areas-move.loca.lt/api/health
```

확인할 항목은 `ready`, `camera.connected`, `region_count`, `analysis_interval_seconds`입니다.
서버 응답뿐 아니라 `camera.connected=true`인지 확인하고, 마지막 분석 시각과 앱 표시가 새로 바뀌는지 확인합니다.
`Failed to fetch`나 HTTP 503이 나오면 현장 서버·터널을 먼저 확인합니다.

## 6. 현장 데이터 보존

- 현재 로컬 `parking_regions.json`에는 Git에 올리지 않은 수정이 있습니다. 위 고정 코드만 받아서는 같은 현장 좌표가 자동 복원되지 않습니다.
- 담당자 PC에서 좌표와 `.occupancy-references/` 기준 사진을 `backups/2026-10-15-review.bKJefA/`에 함께 백업했습니다.
- 좌표 원본과 백업본의 SHA-256은 일치합니다: `bae821d9d4f9e21594c8795b7d56c46f2b8f8a087f14ee1baf1553ed769bd0a0`.
- 이 백업은 Git 제외 경로에 보관되며 공개 업로드하지 않았습니다.
- 같은 현장을 재현할 때는 담당자가 좌표와 기준 사진을 함께 복원하고 앱에서 주차장·층 연결을 확인해야 합니다.

## 7. 퓨처비 원문·10/8 증거 상태

| 자료 | 원문 링크 | 상태 | 다음 행동 |
| --- | --- | --- | --- |
| 에릭이 작성하던 퓨처비 원문 | 미제공 | 문항과 작성 상태 미확인 | 원문 링크 수신 후 실제 문항별 상태표 작성 |
| 10/8 증거 | 미제공 | 링크·공유 권한 미확인 | 원본 증거 링크 수신 후 접근 확인 |

원문을 보지 않았으므로 문항명·학생 답변·작성 완료 여부를 추정해서 채우지 않았습니다.
원문을 받은 뒤 다음 표에 실제 문항 제목과 위치를 그대로 옮깁니다.

| 원문 문항·위치 | 상태(완료/작성 중/빈칸) | 연결 증거 | 확인자·확인일 |
| --- | --- | --- | --- |
| 원문 확인 후 입력 | 미확인 | 미확인 | 미확인 |

## 8. 다른 학생의 링크 열림 확인표

아래 표는 아직 수행하지 않은 확인을 기록하는 양식입니다. 자동 HTTP 점검은 다른 학생의 실제 열람 확인을 대신하지 않습니다.

| 대상 | 학생·기기 | 확인 시각 | 열림 여부 | 권한 요청·문제 |
| --- | --- | --- | --- | --- |
| 학교 고정 코드 링크 | 미확인 | 미확인 | 미확인 | 미확인 |
| 이 실행 안내 | 미확인 | 미확인 | 미확인 | 미확인 |
| 최신 웹 링크 | 미확인 | 미확인 | 미확인 | 미확인 |
| 퓨처비 원문 | 미확인 | 미확인 | 미확인 | 원문 링크 필요 |
| 10/8 증거 | 미확인 | 미확인 | 미확인 | 증거 링크 필요 |

## 9. 업무 1번 완료 증거

| 요구 증거 | 현재 상태 |
| --- | --- |
| 현재 코드 버전·실행 안내 | 이 문서와 고정 커밋·Actions 링크로 준비 완료 |
| 퓨처비 원문 링크·문항 상태표 | 원문 링크 대기 |
| 다른 학생의 링크 열림 결과 | 실제 학생 확인 대기 |

따라서 오늘 업무 1번 전체가 완료된 상태는 아닙니다. 코드·실행 안내 공유를 먼저 마쳤고, 남은 두 증거는 원문 링크와 실제 확인 결과가 필요합니다.

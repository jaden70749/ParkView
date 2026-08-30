# ParkView Raspberry Pi Deployment

## 결론

Raspberry Pi 5 8GB 한 대로 IP 카메라 1대의 프레임을 30초마다 분석하는 구조는 구현 가능하다. 영상 전체를 외부로 보내지 않고 Pi에서 차량 탐지와 주차면 판정을 끝낸 뒤 슬롯 상태 JSON만 Firebase와 앱에 전송한다.

실시간 30fps 분석을 목표로 하지 않는다. 현재 목표는 30초마다 한 프레임이므로 Raspberry Pi CPU만으로도 충분한 범위다. 카메라가 여러 대로 늘거나 분석 주기를 크게 줄일 때는 Hailo 가속기나 별도 서버를 검토한다.

## 권장 구매 구성

- Raspberry Pi 5 8GB
- Raspberry Pi 공식 27W USB-C 전원 공급 장치
- Raspberry Pi 5 Active Cooler 또는 냉각 팬이 포함된 케이스
- 64GB 이상 A2 High Endurance microSD 카드
- CAT6 랜 케이블
- 카메라가 PoE라면 802.3af 호환 PoE 스위치 또는 인젝터
- 선택: 장기 상시 운영 시 microSD 대신 NVMe HAT과 SSD

IP 카메라는 브랜드보다 다음 조건을 먼저 확인한다.

- RTSP와 ONVIF 지원
- 1080p 이상, H.264 또는 H.265
- 고정 설치와 수동 초점 조절 가능
- PoE 지원
- 카메라 내부 시간 동기화 가능

하이크비전 카메라의 일반적인 메인 스트림 주소는 다음 형태다. 모델별 문서에서 실제 경로를 다시 확인한다.

```text
rtsp://사용자:비밀번호@카메라_IP:554/Streaming/Channels/101
```

## 데이터 흐름

```text
IP 카메라 RTSP
  -> Raspberry Pi가 30초마다 한 프레임 캡처
  -> YOLO 실차 클래스 탐지
  -> CCTV 화면의 주차면 ROI와 차량 중심점 매칭
  -> 2회 연속 빈자리 확인 후 empty 확정
  -> 슬롯 번호와 occupied/empty JSON만 Firebase에 전송
  -> 앱이 결과 JSON을 읽어 2D 도면 색상 갱신
```

`PARKVIEW_DEBUG=false`에서는 캡처 원본과 탐지 이미지를 디스크에 저장하지 않는다. 설치·정확도 점검 때만 잠시 `true`로 바꾸고, 점검이 끝나면 생성된 `debug/` 파일을 삭제한다.

## 설치

Raspberry Pi OS Lite 64-bit를 설치하고 유선 LAN으로 연결한다. 프로젝트 폴더에서 다음을 실행한다.

```bash
chmod +x deploy/install-raspberry-pi.sh
sudo ./deploy/install-raspberry-pi.sh
sudo nano /opt/parkview/.env
sudo systemctl start parkview-edge
sudo journalctl -u parkview-edge -f
```

웹 화면은 같은 네트워크에서 다음 주소로 연다.

```text
http://라즈베리파이_IP:5180
```

서비스 상태 확인:

```bash
curl http://127.0.0.1:5180/api/health
curl http://127.0.0.1:5180/api/result
```

## 주차면 ROI 등록

설치 중에만 `/opt/parkview/.env`에서 `PARKVIEW_CALIBRATION_MODE=true`로 바꾸고 `PARKVIEW_ADMIN_TOKEN`에 긴 임의 문자열을 설정한 뒤 서비스를 재시작한다. 같은 네트워크의 브라우저에서 `http://라즈베리파이_IP:5180/calibrate.html`을 열고 관리자 토큰을 입력한다. CCTV 프레임 위 각 주차면의 네 모서리를 누른 뒤 저장한다. 등록을 마치면 반드시 캘리브레이션 모드를 다시 `false`로 바꾸고 서비스를 재시작한다.

운영 좌표는 `/var/lib/parkview/parking_regions.json`에 저장된다. 좌표는 0부터 1까지의 정규화 값이다. 가장 안정적인 방식은 설치된 CCTV 화면에서 각 주차면의 네 꼭짓점을 직접 등록하고, 앱 도면의 `slot_index`와 연결하는 것이다. 이 방식은 비스듬한 CCTV 화면에서도 도면 좌표를 억지로 겹치지 않는다.

```json
{
  "coordinate_system": "normalized_camera_image",
  "slots": [
    {
      "id": "B1-001",
      "slot_index": 0,
      "kind": "normal",
      "polygon": [[0.10, 0.20], [0.20, 0.22], [0.23, 0.48], [0.08, 0.46]]
    }
  ]
}
```

카메라 화면 점을 도면 좌표로 변환해야 하는 현장에서는 `coordinate_system`을 `normalized_plan`으로 두고 `calibration.camera_points`와 `calibration.plan_points`에 서로 대응하는 네 점을 저장한다. 서버는 OpenCV 호모그래피로 차량 중심점을 도면 좌표로 변환한 뒤 슬롯 폴리곤과 매칭한다.

카메라 위치나 화각이 바뀌면 ROI 또는 4점 캘리브레이션을 다시 등록해야 한다.

## 모델

현재 기본 모델은 `models/yolov5su.pt`이며 `car`, `truck`, `bus`, `motorcycle`만 결과에 포함한다. 기존 미니어처 전용 `parkview-toycar.pt`는 실제 CCTV 운영 경로에서 사용하지 않는다.

Pi에서 속도가 부족하면 NCNN으로 내보낸 뒤 `.env`의 모델 경로를 생성된 NCNN 디렉터리로 바꾼다.

```bash
source /opt/parkview/.venv/bin/activate
python scripts/export_ncnn.py
```

## 실제 카메라 도착 후 합격 기준

1. RTSP를 30회 연속 열었을 때 프레임 수신 실패가 없어야 한다.
2. 낮과 야간 조명에서 각 100프레임을 기록한다.
3. 차량 점유 정확도, 빈자리 정확도, 슬롯 매칭 정확도를 따로 계산한다.
4. 카메라 단절 후 서비스가 자동 복구되는지 확인한다.
5. 원본 영상이 Firebase나 앱 네트워크 요청에 포함되지 않는지 확인한다.

실제 CCTV와 현장 이미지가 아직 없으므로 현재 정확도 수치는 확정할 수 없다.

#!/usr/bin/env python3
"""Convert the nationwide parking CSV into ParkView's static map dataset."""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import Counter
from pathlib import Path


KOREA_BOUNDS = (33.0, 38.9, 124.5, 131.9)


def optional_number(value: str) -> float | None:
    try:
        number = float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def estimated_hourly_price(row: dict[str, str]) -> int | None:
    if "무료" in row.get("요금정보", ""):
        return 0

    base_minutes = optional_number(row.get("주차기본시간", ""))
    base_charge = optional_number(row.get("주차기본요금", ""))
    extra_minutes = optional_number(row.get("추가단위시간", ""))
    extra_charge = optional_number(row.get("추가단위요금", ""))
    if base_charge is None:
        return None

    price = base_charge
    remaining_minutes = max(0, 60 - (base_minutes or 0))
    if remaining_minutes:
        if not extra_minutes or extra_charge is None:
            return None
        price += math.ceil(remaining_minutes / extra_minutes) * extra_charge
    return max(0, round(price))


def read_rows(path: Path) -> list[dict[str, str]]:
    for encoding in ("utf-8-sig", "cp949"):
        try:
            with path.open(encoding=encoding, newline="") as source:
                return list(csv.DictReader(source))
        except UnicodeDecodeError:
            continue
    raise ValueError(f"지원하지 않는 CSV 인코딩입니다: {path}")


def convert_row(row: dict[str, str], identifier: str, latitude: float, longitude: float) -> dict:
    total_spaces = optional_number(row.get("주차구획수", ""))
    return {
        "id": identifier,
        "name": row.get("주차장명", "").strip(),
        "address": (
            row.get("소재지도로명주소", "").strip()
            or row.get("소재지지번주소", "").strip()
        ),
        "hourlyPrice": estimated_hourly_price(row),
        "isOpen": True,
        "latitude": latitude,
        "longitude": longitude,
        "totalSpaces": round(total_spaces) if total_spaces and total_spaces > 0 else None,
        "parkingType": row.get("주차장유형", "").strip() or "주차장",
        "feeInfo": row.get("요금정보", "").strip() or "정보 없음",
        "weekdayStart": row.get("평일운영시작시각", "").strip(),
        "weekdayEnd": row.get("평일운영종료시각", "").strip(),
        "phone": row.get("전화번호", "").strip(),
        "hasDisabledSpaces": row.get("장애인전용주차구역보유여부", "").strip(),
        "hasRealtime": False,
        "source": "public-data",
        "referenceDate": row.get("데이터기준일자", "").strip(),
    }


def build_dataset(source_path: Path) -> tuple[list[dict], dict[str, int]]:
    rows = read_rows(source_path)
    identifier_counts: Counter[str] = Counter()
    output: list[dict] = []
    missing_coordinates = 0
    outside_korea = 0

    for row in rows:
        latitude = optional_number(row.get("위도", ""))
        longitude = optional_number(row.get("경도", ""))
        if latitude is None or longitude is None:
            missing_coordinates += 1
            continue
        min_lat, max_lat, min_lng, max_lng = KOREA_BOUNDS
        if not (min_lat <= latitude <= max_lat and min_lng <= longitude <= max_lng):
            outside_korea += 1
            continue

        base_identifier = row.get("주차장관리번호", "").strip() or f"parking-{len(output) + 1}"
        identifier_counts[base_identifier] += 1
        duplicate_index = identifier_counts[base_identifier]
        if duplicate_index == 1:
            identifier = base_identifier
        else:
            provider = row.get("제공기관코드", "").strip() or "duplicate"
            identifier = f"{base_identifier}:{provider}:{duplicate_index}"
        output.append(convert_row(row, identifier, latitude, longitude))

    stats = {
        "csvRows": len(rows),
        "mapReadyRows": len(output),
        "missingCoordinates": missing_coordinates,
        "outsideKorea": outside_korea,
        "uniqueManagementIds": len(identifier_counts),
    }
    return output, stats


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="전국주차장정보표준데이터 CSV")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/parking-lots.json"),
        help="생성할 ParkView JSON 경로",
    )
    args = parser.parse_args()

    lots, stats = build_dataset(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(lots, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

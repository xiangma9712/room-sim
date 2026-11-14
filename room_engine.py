#!/usr/bin/env python3
"""
Core Room Simulation Engine & Multi-Room Data Store.
- Engine code contains ONLY generic simulator logic and layout analysis.
- Catalog and style themes are defined in `catalog.py` and re-exported here.
- User rooms are persisted independently under `data/rooms/<room_id>.json`.
"""

from __future__ import annotations
import json
import math
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from catalog import (
    FURNITURE_CATALOG,
    STYLE_THEMES,
    TABLE_SEAT_PAIRS,
    apply_theme_colors_to_item,
)

__all__ = [
    "FURNITURE_CATALOG",
    "STYLE_THEMES",
    "TABLE_SEAT_PAIRS",
    "apply_theme_colors_to_item",
    "create_empty_room_doc",
    "list_rooms",
    "load_workspace",
    "save_workspace",
    "get_active_room_id",
    "set_active_room",
    "load_room_doc",
    "save_room_doc",
    "delete_room_doc",
    "load_state",
    "save_state",
    "get_data_mtime",
    "get_item_aabb",
    "enrich_item_metrics",
    "compute_wall_snap_position",
    "analyze_layout",
]

ROOT_DIR = Path(__file__).parent
DATA_DIR = ROOT_DIR / "data"
ROOMS_DIR = DATA_DIR / "rooms"
WORKSPACE_FILE = DATA_DIR / "workspace.json"


def _ensure_dirs() -> None:
    ROOMS_DIR.mkdir(parents=True, exist_ok=True)


def _sanitize_room_id(room_id: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9_-]", "_", room_id.strip())
    return clean or f"room_{uuid.uuid4().hex[:6]}"


def _room_path(room_id: str) -> Path:
    return ROOMS_DIR / f"{_sanitize_room_id(room_id)}.json"


def create_empty_room_doc(
    room_id: str,
    name: str = "新規ルーム",
    width: float = 360,
    depth: float = 270,
    height: float = 240,
) -> Dict[str, Any]:
    return {
        "id": _sanitize_room_id(room_id),
        "version": 1,
        "updatedAt": time.time(),
        "room": {
            "name": name,
            "width": width,
            "depth": depth,
            "height": height,
            "theme": "nordic",
            "floorType": "oak",
            "floorColor": "#d8b88c",
            "wallColor": "#f7f6f2",
            "accentWall": "north",
            "accentWallColor": "#dce3df",
            "lighting": "daylight",
            "openings": [],
            "structures": [],
            "zones": [],
        },
        "furniture": [],
    }


def list_rooms() -> List[Dict[str, Any]]:
    _ensure_dirs()
    rooms: List[Dict[str, Any]] = []
    for p in sorted(ROOMS_DIR.glob("*.json")):
        try:
            with open(p, "r", encoding="utf-8") as f:
                doc = json.load(f)
            r = doc.get("room", {})
            rooms.append({
                "id": doc.get("id", p.stem),
                "name": r.get("name", p.stem),
                "width": r.get("width", 360),
                "depth": r.get("depth", 270),
                "height": r.get("height", 240),
                "furnitureCount": len(doc.get("furniture", [])),
                "updatedAt": doc.get("updatedAt", 0),
            })
        except Exception:
            continue
    return rooms


def load_workspace() -> Dict[str, Any]:
    _ensure_dirs()
    if WORKSPACE_FILE.exists():
        try:
            with open(WORKSPACE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    rooms = list_rooms()
    if not rooms:
        default_doc = create_empty_room_doc("sample_room", "サンプルルーム", 360, 270, 240)
        save_room_doc(default_doc)
        active_id = default_doc["id"]
    else:
        active_id = rooms[0]["id"]
    ws = {"activeRoomId": active_id, "updatedAt": time.time()}
    save_workspace(ws)
    return ws


def save_workspace(ws: Dict[str, Any]) -> Dict[str, Any]:
    _ensure_dirs()
    ws["updatedAt"] = time.time()
    tmp = WORKSPACE_FILE.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(ws, f, ensure_ascii=False, indent=2)
    os.replace(tmp, WORKSPACE_FILE)
    return ws


def get_active_room_id() -> str:
    ws = load_workspace()
    active_id = ws.get("activeRoomId", "")
    if active_id and _room_path(active_id).exists():
        return active_id
    rooms = list_rooms()
    if rooms:
        active_id = rooms[0]["id"]
        save_workspace({"activeRoomId": active_id})
        return active_id
    doc = create_empty_room_doc("sample_room", "サンプルルーム", 360, 270, 240)
    save_room_doc(doc)
    save_workspace({"activeRoomId": doc["id"]})
    return doc["id"]


def set_active_room(room_id: str) -> Dict[str, Any]:
    path = _room_path(room_id)
    if not path.exists():
        raise ValueError(f"Room '{room_id}' does not exist.")
    save_workspace({"activeRoomId": _sanitize_room_id(room_id)})
    return load_room_doc(room_id)


def load_room_doc(room_id: Optional[str] = None) -> Dict[str, Any]:
    target_id = _sanitize_room_id(room_id) if room_id else get_active_room_id()
    path = _room_path(target_id)
    if not path.exists():
        raise ValueError(f"Room '{target_id}' not found.")
    with open(path, "r", encoding="utf-8") as f:
        doc = json.load(f)
    doc["id"] = target_id
    return doc


def save_room_doc(doc: Dict[str, Any]) -> Dict[str, Any]:
    _ensure_dirs()
    room_id = _sanitize_room_id(doc.get("id") or get_active_room_id())
    doc["id"] = room_id
    doc["updatedAt"] = time.time()
    path = _room_path(room_id)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
    ws = load_workspace()
    save_workspace(ws)
    return doc


def delete_room_doc(room_id: str) -> None:
    target_id = _sanitize_room_id(room_id)
    path = _room_path(target_id)
    if path.exists():
        path.unlink()
    rooms = list_rooms()
    if rooms:
        ws = load_workspace()
        if ws.get("activeRoomId") == target_id:
            save_workspace({"activeRoomId": rooms[0]["id"]})
    else:
        doc = create_empty_room_doc("sample_room", "サンプルルーム", 360, 270, 240)
        save_room_doc(doc)
        save_workspace({"activeRoomId": doc["id"]})


def load_state() -> Dict[str, Any]:
    return load_room_doc()


def save_state(state: Dict[str, Any]) -> Dict[str, Any]:
    return save_room_doc(state)


def get_data_mtime() -> float:
    _ensure_dirs()
    mtimes = [WORKSPACE_FILE.stat().st_mtime] if WORKSPACE_FILE.exists() else [0.0]
    for p in ROOMS_DIR.glob("*.json"):
        mtimes.append(p.stat().st_mtime)
    return max(mtimes)


def get_item_aabb(item: Dict[str, Any]) -> Tuple[float, float, float, float]:
    w = float(item.get("width", 50))
    d = float(item.get("depth", 50))
    rot = float(item.get("rotation", 0)) % 360
    rad = math.radians(rot)
    cos_r = abs(math.cos(rad))
    sin_r = abs(math.sin(rad))
    eff_w = w * cos_r + d * sin_r
    eff_d = w * sin_r + d * cos_r
    cx = float(item.get("x", 0))
    cz = float(item.get("z", 0))
    return (cx - eff_w / 2.0, cx + eff_w / 2.0, cz - eff_d / 2.0, cz + eff_d / 2.0)


def enrich_item_metrics(item: Dict[str, Any], room_w: float, room_d: float) -> Dict[str, Any]:
    min_x, max_x, min_z, max_z = get_item_aabb(item)
    enriched = dict(item)
    enriched["bounds"] = {
        "min_x": round(min_x, 1),
        "max_x": round(max_x, 1),
        "min_z": round(min_z, 1),
        "max_z": round(max_z, 1),
    }
    enriched["wall_distances_cm"] = {
        "north": round(min_z, 1),
        "south": round(room_d - max_z, 1),
        "west": round(min_x, 1),
        "east": round(room_w - max_x, 1),
    }
    return enriched


def compute_wall_snap_position(
    room_w: float,
    room_d: float,
    item_w: float,
    item_d: float,
    wall: str,
    align: str = "center",
    offset: float = 0.0,
    gap_from_wall: float = 2.0,
    explicit_rotation: Optional[float] = None,
) -> Tuple[float, float, float]:
    wall = wall.lower()
    default_rot = {
        "north": 0.0,
        "south": 180.0,
        "west": 270.0,
        "east": 90.0,
    }.get(wall, 0.0)

    rot = explicit_rotation if explicit_rotation is not None else default_rot
    rad = math.radians(rot)
    eff_w = item_w * abs(math.cos(rad)) + item_d * abs(math.sin(rad))
    eff_d = item_w * abs(math.sin(rad)) + item_d * abs(math.cos(rad))

    margin = 5.0
    if wall in ("north", "south"):
        z = (eff_d / 2.0 + gap_from_wall) if wall == "north" else (room_d - eff_d / 2.0 - gap_from_wall)
        if align in ("left", "west", "start"):
            x = eff_w / 2.0 + margin + offset
        elif align in ("right", "east", "end"):
            x = room_w - eff_w / 2.0 - margin - offset
        else:
            x = room_w / 2.0 + offset
    else:
        x = (eff_w / 2.0 + gap_from_wall) if wall == "west" else (room_w - eff_w / 2.0 - gap_from_wall)
        if align in ("left", "north", "start"):
            z = eff_d / 2.0 + margin + offset
        elif align in ("right", "south", "end"):
            z = room_d - eff_d / 2.0 - margin - offset
        else:
            z = room_d / 2.0 + offset

    return (round(x, 1), round(z, 1), round(rot, 1))


def analyze_layout(state: Dict[str, Any]) -> Dict[str, Any]:
    room = state.get("room", {})
    room_w = float(room.get("width", 360))
    room_d = float(room.get("depth", 270))
    items = state.get("furniture", [])
    openings = room.get("openings", [])

    issues: List[Dict[str, Any]] = []
    warnings: List[Dict[str, Any]] = []

    aabbs: Dict[str, Tuple[float, float, float, float]] = {}
    for it in items:
        iid = it["id"]
        min_x, max_x, min_z, max_z = get_item_aabb(it)
        aabbs[iid] = (min_x, max_x, min_z, max_z)

        tol = -1.0
        out_walls = []
        if min_x < tol:
            out_walls.append(f"西壁に {abs(round(min_x, 1))}cm めり込んでいます")
        if max_x > room_w - tol:
            out_walls.append(f"東壁に {round(max_x - room_w, 1)}cm めり込んでいます")
        if min_z < tol:
            out_walls.append(f"北壁に {abs(round(min_z, 1))}cm めり込んでいます")
        if max_z > room_d - tol:
            out_walls.append(f"南壁に {round(max_z - room_d, 1)}cm めり込んでいます")
        if out_walls:
            issues.append({
                "type": "out_of_bounds",
                "severity": "error",
                "item_id": iid,
                "item_name": it.get("name", iid),
                "message": f"{it.get('name', iid)} が部屋の外にはみ出しています ({', '.join(out_walls)})",
            })

    solid_items = [it for it in items if it.get("type") not in ("rug", "rug_round")]
    for i in range(len(solid_items)):
        for j in range(i + 1, len(solid_items)):
            a = solid_items[i]
            b = solid_items[j]
            ax1, ax2, az1, az2 = aabbs[a["id"]]
            bx1, bx2, bz1, bz2 = aabbs[b["id"]]

            overlap_x = min(ax2, bx2) - max(ax1, bx1)
            overlap_z = min(az2, bz2) - max(az1, bz1)

            types_pair = {str(a.get("type", "")), str(b.get("type", ""))}
            is_table_chair = types_pair in TABLE_SEAT_PAIRS
            max_allowed_overlap = 20.0 if is_table_chair else 1.5

            if overlap_x > max_allowed_overlap and overlap_z > max_allowed_overlap:
                issues.append({
                    "type": "collision",
                    "severity": "error",
                    "item_ids": [a["id"], b["id"]],
                    "message": (
                        f"「{a.get('name')}」と「{b.get('name')}」が干渉（重なり "
                        f"{round(min(overlap_x, overlap_z), 1)}cm）しています"
                    ),
                })
            elif not is_table_chair:
                gap_x = max(0.0, -overlap_x)
                gap_z = max(0.0, -overlap_z)
                if overlap_x > 15 and 12.0 < gap_z < 50.0:
                    warnings.append({
                        "type": "narrow_passage",
                        "severity": "warning",
                        "item_ids": [a["id"], b["id"]],
                        "gap_cm": round(gap_z, 1),
                        "message": f"「{a.get('name')}」と「{b.get('name')}」の南北間隔が {round(gap_z, 1)}cm です（人が通る動線なら60cm以上推奨）",
                    })
                elif overlap_z > 15 and 12.0 < gap_x < 50.0:
                    warnings.append({
                        "type": "narrow_passage",
                        "severity": "warning",
                        "item_ids": [a["id"], b["id"]],
                        "gap_cm": round(gap_x, 1),
                        "message": f"「{a.get('name')}」と「{b.get('name')}」の東西間隔が {round(gap_x, 1)}cm です（人が通る動線なら60cm以上推奨）",
                    })

    for op in openings:
        if op.get("type") not in ("door", "closet"):
            continue
        if op.get("swing") == "sliding":
            continue
        wall = op.get("wall", "west")
        offset = float(op.get("offset", 100))
        op_w = float(op.get("width", 75))
        clearance_depth = 75.0 if op.get("type") == "door" else 55.0

        if wall == "north":
            dx1, dx2, dz1, dz2 = offset - op_w / 2, offset + op_w / 2, 0, clearance_depth
        elif wall == "south":
            dx1, dx2, dz1, dz2 = offset - op_w / 2, offset + op_w / 2, room_d - clearance_depth, room_d
        elif wall == "west":
            dx1, dx2, dz1, dz2 = 0, clearance_depth, offset - op_w / 2, offset + op_w / 2
        else:
            dx1, dx2, dz1, dz2 = room_w - clearance_depth, room_w, offset - op_w / 2, offset + op_w / 2

        for it in solid_items:
            ax1, ax2, az1, az2 = aabbs[it["id"]]
            if min(ax2, dx2) - max(ax1, dx1) > 2.0 and min(az2, dz2) - max(az1, dz1) > 2.0:
                issues.append({
                    "type": "door_blocked",
                    "severity": "error",
                    "item_id": it["id"],
                    "opening_id": op.get("id", "door"),
                    "message": f"「{it.get('name')}」が {wall}壁のドア/扉の開閉・出入りゾーン（{int(clearance_depth)}cm）を塞いでいます",
                })

    for st in room.get("structures", []):
        sx = float(st.get("x", 0))
        sz = float(st.get("z", 0))
        sw = float(st.get("width", 10))
        sd = float(st.get("depth", 10))
        sx1, sx2, sz1, sz2 = sx - sw / 2, sx + sw / 2, sz - sd / 2, sz + sd / 2
        for it in solid_items:
            ax1, ax2, az1, az2 = aabbs[it["id"]]
            ov_x = min(ax2, sx2) - max(ax1, sx1)
            ov_z = min(az2, sz2) - max(az1, sz1)
            if ov_x > 1.5 and ov_z > 1.5:
                issues.append({
                    "type": "structure_collision",
                    "severity": "error",
                    "item_id": it["id"],
                    "message": f"「{it.get('name')}」が室内構造「{st.get('name')}」と {round(min(ov_x, ov_z), 1)}cm 重なっています",
                })

    room_area = room_w * room_d
    furniture_area = sum(
        float(it.get("width", 0)) * float(it.get("depth", 0))
        for it in solid_items
    )
    coverage_pct = round((furniture_area / room_area) * 100.0, 1) if room_area > 0 else 0.0
    if coverage_pct > 42.0:
        warnings.append({
            "type": "high_density",
            "severity": "warning",
            "coverage_pct": coverage_pct,
            "message": f"家具の床占有率が {coverage_pct}% と高めです（理想は25〜35%前後）。圧迫感が出る可能性があります。",
        })

    status = "ok" if not issues else "has_errors"
    return {
        "status": status,
        "room_dimensions_cm": {"width": room_w, "depth": room_d, "height": room.get("height", 240)},
        "room_area_m2": round(room_area / 10000.0, 2),
        "floor_coverage_pct": coverage_pct,
        "coverage_evaluation": (
            "ゆとりあり (Spacious)" if coverage_pct < 25
            else "理想的・バランス良好 (Ideal 25-38%)" if coverage_pct <= 38
            else "やや高め・要動線確認 (Dense)"
        ),
        "error_count": len(issues),
        "warning_count": len(warnings),
        "issues": issues,
        "warnings": warnings,
    }

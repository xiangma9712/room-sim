#!/usr/bin/env python3
"""
MCP (Model Context Protocol) Server for Room-Sim.
Implements JSON-RPC 2.0 over stdio using Python standard library.
Operates on independent room documents under `data/rooms/<room_id>.json`.
"""

from __future__ import annotations
import json
import sys
import uuid
from typing import Any, Dict, List

import room_engine

SERVER_INFO = {
    "name": "room-sim-mcp",
    "version": "2.0.0",
}

TOOLS: List[Dict[str, Any]] = [
    {
        "name": "list_rooms",
        "description": "保存されているコーディネート対象の部屋一覧と、現在アクティブな部屋IDを取得します。各部屋は独立した間取りと家具リストを持ちます。",
        "inputSchema": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "switch_room",
        "description": "操作・表示対象とするアクティブな部屋を切り替えます（ブラウザの表示も即座に切り替わります）。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "room_id": {"type": "string", "description": "切り替え先の部屋ID"},
            },
            "required": ["room_id"],
        },
    },
    {
        "name": "create_room",
        "description": "新しい部屋を作成して保存します（間取り寸法・開口部・室内構造・ゾーンラベルを含めて作成可能）。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "room_id": {"type": "string", "description": "部屋の一意なID (例: 'ldk', 'bedroom_1')"},
                "name": {"type": "string", "description": "部屋の表示名 (例: 'リビング・ダイニング 12.5畳')"},
                "width": {"type": "number", "description": "東西の幅 (cm)"},
                "depth": {"type": "number", "description": "南北の奥行 (cm)"},
                "height": {"type": "number", "description": "天井高 (cm)"},
                "openings": {"type": "array", "description": "窓・ドア・クローゼット等の開口部リスト"},
                "structures": {"type": "array", "description": "カウンター・間仕切り壁・造作収納等の構造物リスト"},
                "zones": {"type": "array", "description": "エリア名ラベルのリスト ([{name, x, z}])"},
                "activate": {"type": "boolean", "description": "作成後にこの部屋をアクティブにするか (デフォルト: true)"},
            },
            "required": ["room_id", "name", "width", "depth"],
        },
    },
    {
        "name": "delete_room",
        "description": "指定した部屋データを削除します。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "room_id": {"type": "string", "description": "削除する部屋ID"},
            },
            "required": ["room_id"],
        },
    },
    {
        "name": "get_room_state",
        "description": (
            "指定した部屋（省略時はアクティブな部屋）のサイズ・内装・開口部・配置されている全家具（壁からの距離cm付き）と、"
            "干渉・動線チェック結果を取得します。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "room_id": {"type": "string", "description": "対象部屋ID (省略時は現在のアクティブな部屋)"},
            },
        },
    },
    {
        "name": "list_catalog",
        "description": "シミュレーター標準のインテリアスタイルテーマ一覧と、標準家具カタログ一覧を取得します。",
        "inputSchema": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "set_room_config",
        "description": (
            "部屋のサイズ（幅・奥行・高さcm）や内装カラー（床材・壁色・アクセントウォール・照明）を変更します。"
            "座標系: 西(x=0)→東(x=width)、北(z=0)→南(z=depth)、単位はcm。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "room_id": {"type": "string", "description": "対象部屋ID (省略時は現在のアクティブな部屋)"},
                "name": {"type": "string", "description": "部屋の名前"},
                "width": {"type": "number", "description": "東西の幅 (cm)"},
                "depth": {"type": "number", "description": "南北の奥行 (cm)"},
                "height": {"type": "number", "description": "天井高 (cm)"},
                "floorType": {
                    "type": "string",
                    "enum": ["oak", "walnut", "ash", "tile", "carpet"],
                },
                "floorColor": {"type": "string"},
                "wallColor": {"type": "string"},
                "accentWall": {
                    "type": "string",
                    "enum": ["north", "south", "east", "west", "none"],
                },
                "accentWallColor": {"type": "string"},
                "lighting": {
                    "type": "string",
                    "enum": ["daylight", "warm", "evening", "studio"],
                },
            },
        },
    },
    {
        "name": "apply_style_theme",
        "description": (
            "部屋と配置済み家具にインテリアスタイルテーマを一括適用します。"
            "('nordic': 北欧ナチュラル, 'japandi': ジャパンディ, 'modern': ホテルライクモダン, 'cafe': ヴィンテージカフェ, 'korean': 韓国風ホワイト)"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "room_id": {"type": "string", "description": "対象部屋ID (省略時は現在のアクティブな部屋)"},
                "theme": {
                    "type": "string",
                    "enum": ["nordic", "japandi", "modern", "cafe", "korean"],
                },
                "recolor_furniture": {
                    "type": "boolean",
                    "description": "既存の家具の色もテーマに合わせて調和させるか (デフォルト: true)",
                },
            },
            "required": ["theme"],
        },
    },
    {
        "name": "set_openings",
        "description": "部屋の窓・掃き出し窓・ドア・クローゼット扉のリストを設定します。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "room_id": {"type": "string", "description": "対象部屋ID (省略時は現在のアクティブな部屋)"},
                "openings": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "type": {"type": "string", "enum": ["door", "window", "balcony_window", "closet"]},
                            "wall": {"type": "string", "enum": ["north", "south", "east", "west"]},
                            "offset": {"type": "number", "description": "壁の始点(北または西)から開口部中心までの距離 (cm)"},
                            "width": {"type": "number"},
                            "height": {"type": "number"},
                            "sillHeight": {"type": "number"},
                            "swing": {"type": "string", "enum": ["in-left", "in-right", "sliding"]},
                        },
                        "required": ["type", "wall", "offset", "width"],
                    },
                },
            },
            "required": ["openings"],
        },
    },
    {
        "name": "set_structures",
        "description": "部屋内のキッチンカウンター、間仕切り壁、造作クローゼット・柱などの固定構造物リストを設定します。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "room_id": {"type": "string", "description": "対象部屋ID (省略時は現在のアクティブな部屋)"},
                "structures": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "name": {"type": "string"},
                            "x": {"type": "number", "description": "中心X座標 (cm)"},
                            "z": {"type": "number", "description": "中心Z座標 (cm)"},
                            "width": {"type": "number", "description": "東西幅 (cm)"},
                            "depth": {"type": "number", "description": "南北奥行 (cm)"},
                            "height": {"type": "number", "description": "高さ (cm)"},
                            "color": {"type": "string"},
                        },
                        "required": ["name", "x", "z", "width", "depth", "height"],
                    },
                },
                "zones": {
                    "type": "array",
                    "description": "任意のゾーン表示ラベル ([{name, x, z}])",
                },
            },
            "required": ["structures"],
        },
    },
    {
        "name": "add_furniture",
        "description": (
            "部屋に家具を追加します。`preset` で標準家具を指定でき、`wall` ('north'|'south'|'east'|'west') と "
            "`align` ('left'|'center'|'right') を指定すると壁に沿って自動配置されます。`x`, `z`, `rotation` で直接座標指定も可能です。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "room_id": {"type": "string", "description": "対象部屋ID (省略時は現在のアクティブな部屋)"},
                "preset": {"type": "string", "description": "カタログプリセット名"},
                "type": {"type": "string"},
                "name": {"type": "string"},
                "width": {"type": "number"},
                "depth": {"type": "number"},
                "height": {"type": "number"},
                "wall": {"type": "string", "enum": ["north", "south", "east", "west"]},
                "align": {"type": "string", "enum": ["left", "center", "right"]},
                "offset": {"type": "number"},
                "gap_from_wall": {"type": "number"},
                "x": {"type": "number"},
                "z": {"type": "number"},
                "rotation": {"type": "number"},
                "color": {"type": "string"},
                "subColor": {"type": "string"},
            },
        },
    },
    {
        "name": "update_furniture",
        "description": "既存の家具の位置・回転・サイズ・色を更新します。`wall` 指定での再スナップも可能です。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "room_id": {"type": "string", "description": "対象部屋ID (省略時は現在のアクティブな部屋)"},
                "id": {"type": "string", "description": "対象家具のID (または名前)"},
                "name": {"type": "string"},
                "width": {"type": "number"},
                "depth": {"type": "number"},
                "height": {"type": "number"},
                "wall": {"type": "string", "enum": ["north", "south", "east", "west"]},
                "align": {"type": "string", "enum": ["left", "center", "right"]},
                "offset": {"type": "number"},
                "gap_from_wall": {"type": "number"},
                "x": {"type": "number"},
                "z": {"type": "number"},
                "rotation": {"type": "number"},
                "color": {"type": "string"},
                "subColor": {"type": "string"},
            },
            "required": ["id"],
        },
    },
    {
        "name": "remove_furniture",
        "description": "指定したIDの家具を削除します。`id: 'all'` を指定するとその部屋の全家具をクリアします。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "room_id": {"type": "string", "description": "対象部屋ID (省略時は現在のアクティブな部屋)"},
                "id": {"type": "string", "description": "削除する家具のID、または 'all'"},
            },
            "required": ["id"],
        },
    },
    {
        "name": "analyze_layout",
        "description": "指定した部屋（省略時はアクティブな部屋）のレイアウト診断（壁のはみ出し、家具同士の衝突、ドア・構造物干渉、通路幅、床占有率%）を実行します。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "room_id": {"type": "string", "description": "対象部屋ID (省略時は現在のアクティブな部屋)"},
            },
        },
    },
]


def _apply_theme_colors_to_item(item: Dict[str, Any], palette: Dict[str, str]) -> None:
    room_engine.apply_theme_colors_to_item(item, palette)


def handle_tool_call(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    if name == "list_rooms":
        return {
            "activeRoomId": room_engine.get_active_room_id(),
            "rooms": room_engine.list_rooms(),
        }

    if name == "switch_room":
        doc = room_engine.set_active_room(args["room_id"])
        return {
            "message": f"アクティブな部屋を『{doc['room']['name']}』({doc['id']}) に切り替えました",
            "activeRoomId": doc["id"],
            "room": doc["room"],
            "furnitureCount": len(doc.get("furniture", [])),
            "layout_analysis": room_engine.analyze_layout(doc),
        }

    if name == "create_room":
        doc = room_engine.create_empty_room_doc(
            room_id=args["room_id"],
            name=args["name"],
            width=float(args["width"]),
            depth=float(args["depth"]),
            height=float(args.get("height", 240)),
        )
        if "openings" in args and args["openings"] is not None:
            doc["room"]["openings"] = args["openings"]
        if "structures" in args and args["structures"] is not None:
            doc["room"]["structures"] = args["structures"]
        if "zones" in args and args["zones"] is not None:
            doc["room"]["zones"] = args["zones"]

        room_engine.save_room_doc(doc)
        if args.get("activate", True):
            room_engine.set_active_room(doc["id"])

        return {
            "message": f"部屋『{doc['room']['name']}』({doc['id']}) を作成しました",
            "room_id": doc["id"],
            "room": doc["room"],
        }

    if name == "delete_room":
        target_id = args["room_id"]
        room_engine.delete_room_doc(target_id)
        return {
            "message": f"部屋 '{target_id}' を削除しました",
            "activeRoomId": room_engine.get_active_room_id(),
            "rooms": room_engine.list_rooms(),
        }

    if name in ("list_catalog", "list_catalog_and_presets"):
        return {
            "style_themes": room_engine.STYLE_THEMES,
            "furniture_catalog": room_engine.FURNITURE_CATALOG,
        }

    # All remaining tools operate on a specific room_id (or the currently active room)
    target_room_id = args.get("room_id")
    state = room_engine.load_room_doc(target_room_id)
    room = state["room"]
    items = state["furniture"]

    if name == "get_room_state":
        rw, rd = float(room["width"]), float(room["depth"])
        enriched_items = [room_engine.enrich_item_metrics(it, rw, rd) for it in items]
        analysis = room_engine.analyze_layout(state)
        return {
            "room_id": state["id"],
            "room": room,
            "furniture": enriched_items,
            "layout_analysis": analysis,
        }

    if name == "set_room_config":
        for field in (
            "name",
            "width",
            "depth",
            "height",
            "floorType",
            "floorColor",
            "wallColor",
            "accentWall",
            "accentWallColor",
            "lighting",
        ):
            if field in args and args[field] is not None:
                room[field] = args[field]

        room_engine.save_room_doc(state)
        return {
            "message": f"部屋『{room['name']}』の設定を更新しました",
            "room_id": state["id"],
            "room": room,
            "layout_analysis": room_engine.analyze_layout(state),
        }

    if name == "apply_style_theme":
        theme_key = args.get("theme", "nordic")
        if theme_key not in room_engine.STYLE_THEMES:
            raise ValueError(f"Unknown theme: {theme_key}")
        theme = room_engine.STYLE_THEMES[theme_key]
        room["theme"] = theme_key
        room["floorType"] = theme["floorType"]
        room["floorColor"] = theme["floorColor"]
        room["wallColor"] = theme["wallColor"]
        room["accentWall"] = theme["accentWall"]
        room["accentWallColor"] = theme["accentWallColor"]
        room["lighting"] = theme["lighting"]

        if args.get("recolor_furniture", True):
            for it in items:
                _apply_theme_colors_to_item(it, theme["palette"])

        room_engine.save_room_doc(state)
        return {
            "message": f"部屋『{room['name']}』にスタイルテーマ『{theme['name']}』を適用しました",
            "room_id": state["id"],
            "room": room,
        }

    if name == "set_openings":
        new_openings = []
        for idx, op in enumerate(args.get("openings", [])):
            otype = op.get("type", "window")
            new_openings.append({
                "id": op.get("id") or f"{otype}_{idx+1}",
                "type": otype,
                "wall": op.get("wall", "east"),
                "offset": float(op.get("offset", 120)),
                "width": float(op.get("width", 75 if otype == "door" else 160)),
                "height": float(op.get("height", 200 if otype == "door" else (190 if otype == "balcony_window" else 110))),
                "sillHeight": float(op.get("sillHeight", 85 if otype == "window" else 0)),
                "swing": op.get("swing", "in-left" if otype == "door" else "sliding"),
            })
        room["openings"] = new_openings
        room_engine.save_room_doc(state)
        return {
            "message": f"{len(new_openings)}箇所の開口部（窓・ドア）を設定しました",
            "room_id": state["id"],
            "openings": new_openings,
            "layout_analysis": room_engine.analyze_layout(state),
        }

    if name == "set_structures":
        room["structures"] = args.get("structures", [])
        if "zones" in args and args["zones"] is not None:
            room["zones"] = args["zones"]
        room_engine.save_room_doc(state)
        return {
            "message": f"{len(room['structures'])}個の室内構造物を設定しました",
            "room_id": state["id"],
            "structures": room["structures"],
            "layout_analysis": room_engine.analyze_layout(state),
        }

    if name == "add_furniture":
        preset_key = args.get("preset")
        base = dict(room_engine.FURNITURE_CATALOG.get(preset_key, {})) if preset_key else {}

        theme_key = room.get("theme", "nordic")
        palette = room_engine.STYLE_THEMES.get(theme_key, room_engine.STYLE_THEMES["nordic"])["palette"]

        ftype = args.get("type") or base.get("type", "box")
        fname = args.get("name") or base.get("name", ftype)
        w = float(args.get("width") or base.get("width", 80))
        d = float(args.get("depth") or base.get("depth", 50))
        h = float(args.get("height") or base.get("height", 70))

        rw, rd = float(room["width"]), float(room["depth"])
        wall = args.get("wall")
        if wall:
            x, z, rot = room_engine.compute_wall_snap_position(
                room_w=rw,
                room_d=rd,
                item_w=w,
                item_d=d,
                wall=wall,
                align=args.get("align", "center"),
                offset=float(args.get("offset", 0.0)),
                gap_from_wall=float(args.get("gap_from_wall", 2.0)),
                explicit_rotation=float(args["rotation"]) if "rotation" in args and args["rotation"] is not None else None,
            )
        else:
            x = float(args.get("x", rw / 2.0))
            z = float(args.get("z", rd / 2.0))
            rot = float(args.get("rotation", 0.0))

        item: Dict[str, Any] = {
            "id": f"item_{uuid.uuid4().hex[:6]}",
            "preset": preset_key or ftype,
            "type": ftype,
            "name": fname,
            "width": w,
            "depth": d,
            "height": h,
            "x": round(x, 1),
            "z": round(z, 1),
            "rotation": round(rot % 360, 1),
            "color": base.get("color", "#dfc196"),
            "subColor": base.get("subColor", "#8fa39a"),
        }
        _apply_theme_colors_to_item(item, palette)
        if args.get("color"):
            item["color"] = args["color"]
        if args.get("subColor"):
            item["subColor"] = args["subColor"]

        items.append(item)
        room_engine.save_room_doc(state)
        return {
            "message": f"『{room['name']}』に「{fname}」を追加しました",
            "room_id": state["id"],
            "item": room_engine.enrich_item_metrics(item, rw, rd),
            "layout_analysis": room_engine.analyze_layout(state),
        }

    if name == "update_furniture":
        target_id = args["id"]
        target = None
        for it in items:
            if it["id"] == target_id or it.get("name") == target_id:
                target = it
                break
        if not target:
            for it in items:
                if target_id in it.get("name", "") or target_id in it.get("type", ""):
                    target = it
                    break
        if not target:
            raise ValueError(f"Furniture item '{target_id}' not found in room '{state['id']}'.")

        for field in ("name", "width", "depth", "height", "color", "subColor"):
            if field in args and args[field] is not None:
                target[field] = args[field]

        rw, rd = float(room["width"]), float(room["depth"])
        if "wall" in args and args["wall"]:
            x, z, rot = room_engine.compute_wall_snap_position(
                room_w=rw,
                room_d=rd,
                item_w=float(target["width"]),
                item_d=float(target["depth"]),
                wall=args["wall"],
                align=args.get("align", "center"),
                offset=float(args.get("offset", 0.0)),
                gap_from_wall=float(args.get("gap_from_wall", 2.0)),
                explicit_rotation=float(args["rotation"]) if "rotation" in args and args["rotation"] is not None else None,
            )
            target["x"] = x
            target["z"] = z
            target["rotation"] = rot
        else:
            if "x" in args and args["x"] is not None:
                target["x"] = round(float(args["x"]), 1)
            if "z" in args and args["z"] is not None:
                target["z"] = round(float(args["z"]), 1)
            if "rotation" in args and args["rotation"] is not None:
                target["rotation"] = round(float(args["rotation"]) % 360, 1)

        room_engine.save_room_doc(state)
        return {
            "message": f"「{target['name']}」を更新しました",
            "room_id": state["id"],
            "item": room_engine.enrich_item_metrics(target, rw, rd),
            "layout_analysis": room_engine.analyze_layout(state),
        }

    if name == "remove_furniture":
        target_id = args["id"]
        if target_id == "all":
            count = len(items)
            state["furniture"] = []
            room_engine.save_room_doc(state)
            return {
                "message": f"『{room['name']}』の全 {count} 点の家具を削除しました",
                "room_id": state["id"],
            }

        before = len(items)
        state["furniture"] = [it for it in items if it["id"] != target_id and it.get("name") != target_id]
        if len(state["furniture"]) == before:
            raise ValueError(f"Furniture item '{target_id}' not found.")
        room_engine.save_room_doc(state)
        return {
            "message": f"家具 '{target_id}' を削除しました",
            "room_id": state["id"],
            "layout_analysis": room_engine.analyze_layout(state),
        }

    if name == "analyze_layout":
        return room_engine.analyze_layout(state)

    raise ValueError(f"Unknown tool: {name}")


def send_response(msg: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> None:
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue

        method = req.get("method")
        req_id = req.get("id")
        params = req.get("params") or {}

        if req_id is None:
            continue

        try:
            if method == "initialize":
                send_response({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "protocolVersion": params.get("protocolVersion", "2024-11-05"),
                        "capabilities": {"tools": {"listChanged": False}},
                        "serverInfo": SERVER_INFO,
                    },
                })
            elif method == "ping":
                send_response({"jsonrpc": "2.0", "id": req_id, "result": {}})
            elif method == "tools/list":
                send_response({"jsonrpc": "2.0", "id": req_id, "result": {"tools": TOOLS}})
            elif method == "tools/call":
                t_name = params.get("name", "")
                t_args = params.get("arguments") or {}
                res_data = handle_tool_call(t_name, t_args)
                send_response({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [{"type": "text", "text": json.dumps(res_data, ensure_ascii=False, indent=2)}],
                        "isError": False,
                    },
                })
            else:
                send_response({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32601, "message": f"Method not found: {method}"},
                })
        except Exception as exc:
            send_response({
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": f"Error: {exc}"}],
                    "isError": True,
                },
            })


if __name__ == "__main__":
    main()

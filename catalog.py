#!/usr/bin/env python3
"""
Interior Style Themes & Generic Furniture Catalog for Room-Sim.
Separated from engine & server logic for easy maintenance.
"""

from __future__ import annotations
from typing import Any, Dict, Set, Tuple

STYLE_THEMES: Dict[str, Dict[str, Any]] = {
    "nordic": {
        "name": "北欧ナチュラル (Nordic Natural)",
        "floorType": "oak",
        "floorColor": "#d8b88c",
        "wallColor": "#f7f6f2",
        "accentWall": "north",
        "accentWallColor": "#dce3df",
        "lighting": "daylight",
        "palette": {
            "wood": "#dfc196",
            "fabric": "#8fa39a",
            "subFabric": "#e8e4dc",
            "metal": "#f0f0f0",
            "rug": "#e2ddd5",
        },
    },
    "japandi": {
        "name": "ジャパンディ (Japandi Warm Minimal)",
        "floorType": "ash",
        "floorColor": "#cbb799",
        "wallColor": "#f2efe9",
        "accentWall": "west",
        "accentWallColor": "#e0dbd1",
        "lighting": "warm",
        "palette": {
            "wood": "#b99c75",
            "fabric": "#c9c0b1",
            "subFabric": "#dcd6cc",
            "metal": "#2b2b2b",
            "rug": "#d8d0c3",
        },
    },
    "modern": {
        "name": "ホテルライク・モダン (Modern Monotone)",
        "floorType": "tile",
        "floorColor": "#8c8d91",
        "wallColor": "#f4f4f6",
        "accentWall": "north",
        "accentWallColor": "#3c4048",
        "lighting": "studio",
        "palette": {
            "wood": "#363330",
            "fabric": "#4a4e54",
            "subFabric": "#9ea3ab",
            "metal": "#1f1f1f",
            "rug": "#bcbec2",
        },
    },
    "cafe": {
        "name": "ヴィンテージ・カフェ (Walnut & Cafe)",
        "floorType": "walnut",
        "floorColor": "#7a5236",
        "wallColor": "#f3eee6",
        "accentWall": "north",
        "accentWallColor": "#526356",
        "lighting": "warm",
        "palette": {
            "wood": "#6b442a",
            "fabric": "#9c5a3c",
            "subFabric": "#d4c3b3",
            "metal": "#242424",
            "rug": "#c2b39b",
        },
    },
    "korean": {
        "name": "韓国風ホワイト・アイボリー (White & Cream)",
        "floorType": "ash",
        "floorColor": "#e6dac8",
        "wallColor": "#faf8f5",
        "accentWall": "none",
        "accentWallColor": "#f0ece1",
        "lighting": "warm",
        "palette": {
            "wood": "#e5d0b1",
            "fabric": "#f4efe6",
            "subFabric": "#e5dec9",
            "metal": "#d4af37",
            "rug": "#f2ede4",
        },
    },
}

FURNITURE_CATALOG: Dict[str, Dict[str, Any]] = {
    "bed_single": {
        "type": "bed",
        "name": "シングルベッド",
        "width": 100,
        "depth": 200,
        "height": 45,
        "color": "#dfc196",
        "subColor": "#8fa39a",
        "category": "sleep",
    },
    "bed_semidouble": {
        "type": "bed",
        "name": "セミダブルベッド",
        "width": 120,
        "depth": 200,
        "height": 45,
        "color": "#dfc196",
        "subColor": "#8fa39a",
        "category": "sleep",
    },
    "bed_low_sd": {
        "type": "bed",
        "name": "ローベッド セミダブル (15cmフレーム)",
        "width": 120,
        "depth": 200,
        "height": 33,
        "color": "#dfc196",
        "subColor": "#e8e4dc",
        "category": "sleep",
    },
    "baby_crib": {
        "type": "baby_crib",
        "name": "ベビーベッド (レギュラー 125×78)",
        "width": 125,
        "depth": 78,
        "height": 92,
        "color": "#e8d3b3",
        "subColor": "#faf8f5",
        "category": "kids",
    },
    "bed_double": {
        "type": "bed",
        "name": "ダブルベッド",
        "width": 140,
        "depth": 200,
        "height": 45,
        "color": "#dfc196",
        "subColor": "#8fa39a",
        "category": "sleep",
    },
    "sofa_2p": {
        "type": "sofa",
        "name": "2人掛けソファ",
        "width": 150,
        "depth": 80,
        "height": 78,
        "color": "#8fa39a",
        "subColor": "#dfc196",
        "category": "living",
    },
    "sofa_3p": {
        "type": "sofa",
        "name": "3人掛けソファ",
        "width": 195,
        "depth": 85,
        "height": 78,
        "color": "#8fa39a",
        "subColor": "#dfc196",
        "category": "living",
    },
    "sofa_1p": {
        "type": "sofa",
        "name": "ラウンジチェア",
        "width": 75,
        "depth": 78,
        "height": 75,
        "color": "#c9966b",
        "subColor": "#dfc196",
        "category": "living",
    },
    "low_table": {
        "type": "low_table",
        "name": "ローテーブル",
        "width": 100,
        "depth": 50,
        "height": 38,
        "color": "#dfc196",
        "subColor": "#2b2b2b",
        "category": "living",
    },
    "round_table": {
        "type": "round_table",
        "name": "カフェ丸テーブル",
        "width": 80,
        "depth": 80,
        "height": 72,
        "color": "#dfc196",
        "subColor": "#f0f0f0",
        "category": "dining",
    },
    "dining_table": {
        "type": "dining_table",
        "name": "ダイニングテーブル (4人用)",
        "width": 140,
        "depth": 80,
        "height": 72,
        "color": "#dfc196",
        "subColor": "#2b2b2b",
        "category": "dining",
    },
    "desk": {
        "type": "desk",
        "name": "ワークデスク",
        "width": 120,
        "depth": 60,
        "height": 72,
        "color": "#dfc196",
        "subColor": "#2b2b2b",
        "category": "work",
    },
    "desk_compact": {
        "type": "desk",
        "name": "コンパクトデスク",
        "width": 90,
        "depth": 50,
        "height": 72,
        "color": "#dfc196",
        "subColor": "#f0f0f0",
        "category": "work",
    },
    "standing_desk": {
        "type": "standing_desk",
        "name": "昇降デスク (120×60) + ウルトラワイド",
        "width": 120,
        "depth": 60,
        "height": 73,
        "color": "#dfc196",
        "subColor": "#f3f4f6",
        "category": "work",
    },
    "balance_ball": {
        "type": "balance_ball",
        "name": "バランスボール (65cm)",
        "width": 65,
        "depth": 65,
        "height": 65,
        "color": "#8fa39a",
        "subColor": "#d8d0c3",
        "category": "work",
    },
    "office_chair": {
        "type": "office_chair",
        "name": "ワークチェア",
        "width": 60,
        "depth": 60,
        "height": 90,
        "color": "#383b40",
        "subColor": "#2b2b2b",
        "category": "work",
    },
    "chair": {
        "type": "chair",
        "name": "ダイニングチェア",
        "width": 48,
        "depth": 52,
        "height": 78,
        "color": "#dfc196",
        "subColor": "#e8e4dc",
        "category": "dining",
    },
    "dining_bench": {
        "type": "bench",
        "name": "ダイニングベンチ (背なし)",
        "width": 130,
        "depth": 38,
        "height": 43,
        "color": "#dfc196",
        "subColor": "#8fa39a",
        "category": "dining",
    },
    "tv_board": {
        "type": "tv_board",
        "name": "TVボード (TV付)",
        "width": 120,
        "depth": 40,
        "height": 42,
        "color": "#dfc196",
        "subColor": "#1e1e1e",
        "category": "storage",
    },
    "bookshelf": {
        "type": "bookshelf",
        "name": "オープンシェルフ",
        "width": 80,
        "depth": 32,
        "height": 140,
        "color": "#dfc196",
        "subColor": "#e8e4dc",
        "category": "storage",
    },
    "low_shelf": {
        "type": "bookshelf",
        "name": "ローシェルフ",
        "width": 120,
        "depth": 35,
        "height": 80,
        "color": "#dfc196",
        "subColor": "#e8e4dc",
        "category": "storage",
    },
    "wardrobe": {
        "type": "wardrobe",
        "name": "ワードローブ / チェスト",
        "width": 80,
        "depth": 55,
        "height": 180,
        "color": "#f4f2ed",
        "subColor": "#dfc196",
        "category": "storage",
    },
    "side_table": {
        "type": "side_table",
        "name": "ナイトテーブル",
        "width": 40,
        "depth": 40,
        "height": 50,
        "color": "#dfc196",
        "subColor": "#f0f0f0",
        "category": "living",
    },
    "rug_m": {
        "type": "rug",
        "name": "ラグマット (140×200)",
        "width": 140,
        "depth": 200,
        "height": 2,
        "color": "#e2ddd5",
        "subColor": "#d0c9be",
        "category": "decor",
    },
    "rug_round": {
        "type": "rug_round",
        "name": "円形ラグ (φ150)",
        "width": 150,
        "depth": 150,
        "height": 2,
        "color": "#e2ddd5",
        "subColor": "#d0c9be",
        "category": "decor",
    },
    "plant": {
        "type": "plant",
        "name": "観葉植物",
        "width": 45,
        "depth": 45,
        "height": 130,
        "color": "#4f7942",
        "subColor": "#e8e2d5",
        "category": "decor",
    },
    "floor_lamp": {
        "type": "floor_lamp",
        "name": "フロアスタンド照明",
        "width": 38,
        "depth": 38,
        "height": 155,
        "color": "#fff6e0",
        "subColor": "#2b2b2b",
        "category": "decor",
    },
    "baby_pen": {
        "type": "baby_pen",
        "name": "ベビーサークル (150×150)",
        "width": 150,
        "depth": 150,
        "height": 65,
        "color": "#f3efe6",
        "subColor": "#e2ddd2",
        "category": "kids",
    },
    "kitchen_cabinet": {
        "type": "kitchen_cabinet",
        "name": "キッチンカウンター W800",
        "width": 80,
        "depth": 45,
        "height": 89,
        "color": "#6b442a",
        "subColor": "#d1d5db",
        "category": "storage",
    },
}

# Pairs of furniture types that are allowed to tuck into each other up to 20cm
TABLE_SEAT_PAIRS: Tuple[Set[str], ...] = (
    {"desk", "office_chair"},
    {"desk", "chair"},
    {"desk", "balance_ball"},
    {"standing_desk", "office_chair"},
    {"standing_desk", "balance_ball"},
    {"standing_desk", "chair"},
    {"dining_table", "chair"},
    {"dining_table", "bench"},
    {"round_table", "chair"},
)


def apply_theme_colors_to_item(item: Dict[str, Any], palette: Dict[str, str]) -> None:
    """Harmonizes a furniture item's primary and secondary colors to the given theme palette."""
    ftype = item.get("type", "box")
    if ftype == "bed":
        item["color"] = palette["wood"]
        item["subColor"] = palette["fabric"]
    elif ftype == "sofa":
        item["color"] = palette["fabric"]
        item["subColor"] = palette["wood"]
    elif ftype in ("low_table", "dining_table", "desk"):
        item["color"] = palette["wood"]
        item["subColor"] = palette["metal"]
    elif ftype in ("round_table", "side_table"):
        item["color"] = palette["wood"]
        item["subColor"] = palette["subFabric"]
    elif ftype in ("bookshelf", "tv_board"):
        item["color"] = palette["wood"]
        item["subColor"] = palette["subFabric"]
    elif ftype == "wardrobe":
        item["color"] = palette["subFabric"]
        item["subColor"] = palette["wood"]
    elif ftype in ("chair", "office_chair"):
        item["color"] = palette["subFabric"] if ftype == "chair" else palette["metal"]
        item["subColor"] = palette["wood"]
    elif ftype in ("rug", "rug_round"):
        item["color"] = palette["rug"]

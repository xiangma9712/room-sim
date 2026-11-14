#!/usr/bin/env python3
"""
Characterization & Specification Test Suite for Room-Sim.
Following t-wada's testing principles & Kent Beck's 'Tidy First?':
1. Pin all existing observable behavior (Golden Master / Characterization) before refactoring.
2. Isolate file I/O using temporary directories so user data in `data/` is never mutated by tests.
3. Verify zero behavioral changes across every structural refactoring step.
"""

from __future__ import annotations
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import catalog
import mcp_server
import room_engine


EXPECTED_STYLE_THEME_KEYS = {"nordic", "japandi", "modern", "cafe", "korean"}

EXPECTED_CATALOG_KEYS = {
    "bed_single",
    "bed_semidouble",
    "bed_low_sd",
    "baby_crib",
    "bed_double",
    "sofa_2p",
    "sofa_3p",
    "sofa_1p",
    "low_table",
    "round_table",
    "dining_table",
    "desk",
    "desk_compact",
    "standing_desk",
    "balance_ball",
    "office_chair",
    "chair",
    "dining_bench",
    "tv_board",
    "bookshelf",
    "low_shelf",
    "wardrobe",
    "side_table",
    "rug_m",
    "rug_round",
    "plant",
    "floor_lamp",
    "baby_pen",
    "kitchen_cabinet",
}


class IsolatedDataTestCase(unittest.TestCase):
    """Base test case that redirects room_engine's DATA_DIR to an isolated temp directory."""

    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self._tmpdir.name)
        self.rooms_dir = self.tmp_path / "rooms"
        self.workspace_file = self.tmp_path / "workspace.json"

        self._patchers = [
            mock.patch.object(room_engine, "DATA_DIR", self.tmp_path),
            mock.patch.object(room_engine, "ROOMS_DIR", self.rooms_dir),
            mock.patch.object(room_engine, "WORKSPACE_FILE", self.workspace_file),
        ]
        for p in self._patchers:
            p.start()

    def tearDown(self) -> None:
        for p in reversed(self._patchers):
            p.stop()
        self._tmpdir.cleanup()


class TestCatalogAndThemesContract(unittest.TestCase):
    """Ensures catalog and theme contracts remain 100% identical after extraction."""

    def test_style_themes_structure(self) -> None:
        self.assertEqual(set(room_engine.STYLE_THEMES.keys()), EXPECTED_STYLE_THEME_KEYS)
        required_theme_fields = {
            "name",
            "floorType",
            "floorColor",
            "wallColor",
            "accentWall",
            "accentWallColor",
            "lighting",
            "palette",
        }
        required_palette_fields = {"wood", "fabric", "subFabric", "metal", "rug"}
        for key, theme in room_engine.STYLE_THEMES.items():
            with self.subTest(theme=key):
                self.assertTrue(required_theme_fields.issubset(theme.keys()))
                self.assertEqual(set(theme["palette"].keys()), required_palette_fields)

    def test_furniture_catalog_structure_and_values(self) -> None:
        self.assertEqual(set(room_engine.FURNITURE_CATALOG.keys()), EXPECTED_CATALOG_KEYS)
        required_fields = {"type", "name", "width", "depth", "height", "color", "subColor", "category"}
        for key, item in room_engine.FURNITURE_CATALOG.items():
            with self.subTest(preset=key):
                self.assertEqual(set(item.keys()), required_fields)
                self.assertGreater(item["width"], 0)
                self.assertGreater(item["depth"], 0)
                self.assertGreater(item["height"], 0)
                self.assertTrue(str(item["color"]).startswith("#"))
                self.assertTrue(str(item["subColor"]).startswith("#"))

    def test_specific_catalog_dimensions_pinned(self) -> None:
        cat = room_engine.FURNITURE_CATALOG
        self.assertEqual((cat["bed_low_sd"]["width"], cat["bed_low_sd"]["depth"], cat["bed_low_sd"]["height"]), (120, 200, 33))
        self.assertEqual((cat["baby_crib"]["width"], cat["baby_crib"]["depth"], cat["baby_crib"]["height"]), (125, 78, 92))
        self.assertEqual((cat["standing_desk"]["width"], cat["standing_desk"]["depth"], cat["standing_desk"]["height"]), (120, 60, 73))
        self.assertEqual((cat["baby_pen"]["width"], cat["baby_pen"]["depth"], cat["baby_pen"]["height"]), (150, 150, 65))
        self.assertEqual((cat["dining_bench"]["width"], cat["dining_bench"]["depth"], cat["dining_bench"]["height"]), (130, 38, 43))

    def test_apply_theme_colors_to_item(self) -> None:
        palette = catalog.STYLE_THEMES["japandi"]["palette"]
        for key, spec in catalog.FURNITURE_CATALOG.items():
            with self.subTest(preset=key):
                self.assertIn(spec["type"], catalog.TYPE_THEME_PALETTE_MAP)

        desk = dict(catalog.FURNITURE_CATALOG["standing_desk"])
        catalog.apply_theme_colors_to_item(desk, palette)
        self.assertEqual(desk["color"], palette["wood"])
        self.assertEqual(desk["subColor"], palette["metal"])

        crib = dict(catalog.FURNITURE_CATALOG["baby_crib"])
        catalog.apply_theme_colors_to_item(crib, palette)
        self.assertEqual(crib["color"], palette["wood"])
        self.assertEqual(crib["subColor"], palette["subFabric"])

        bench = dict(catalog.FURNITURE_CATALOG["dining_bench"])
        catalog.apply_theme_colors_to_item(bench, palette)
        self.assertEqual(bench["color"], palette["wood"])
        self.assertEqual(bench["subColor"], palette["fabric"])

        plant = dict(catalog.FURNITURE_CATALOG["plant"])
        orig_leaf_color = plant["color"]
        catalog.apply_theme_colors_to_item(plant, palette)
        self.assertEqual(plant["color"], orig_leaf_color)
        self.assertEqual(plant["subColor"], palette["subFabric"])

    def test_frontend_mesh_builder_covers_all_catalog_types(self) -> None:
        meshes_js = (Path(__file__).parent.parent / "static" / "meshes.js").read_text(encoding="utf-8")
        for key, spec in catalog.FURNITURE_CATALOG.items():
            item_type = spec["type"]
            with self.subTest(preset=key, item_type=item_type):
                self.assertIn(f'"{item_type}"', meshes_js)


class TestGeometryAndWallSnap(unittest.TestCase):
    """Tests coordinate math, bounding boxes, and wall snapping."""

    def test_get_item_aabb_unrotated_and_rotated(self) -> None:
        item_0 = {"width": 160, "depth": 80, "x": 200, "z": 150, "rotation": 0}
        self.assertEqual(room_engine.get_item_aabb(item_0), (120.0, 280.0, 110.0, 190.0))

        # Rotated 90 deg: effective width becomes 80, effective depth becomes 160
        item_90 = {"width": 160, "depth": 80, "x": 200, "z": 150, "rotation": 90}
        min_x, max_x, min_z, max_z = room_engine.get_item_aabb(item_90)
        self.assertAlmostEqual(min_x, 160.0)
        self.assertAlmostEqual(max_x, 240.0)
        self.assertAlmostEqual(min_z, 70.0)
        self.assertAlmostEqual(max_z, 230.0)

    def test_enrich_item_metrics(self) -> None:
        item = {"id": "it1", "width": 100, "depth": 60, "x": 80, "z": 50, "rotation": 0}
        enriched = room_engine.enrich_item_metrics(item, room_w=300, room_d=200)
        self.assertEqual(enriched["bounds"], {"min_x": 30.0, "max_x": 130.0, "min_z": 20.0, "max_z": 80.0})
        self.assertEqual(
            enriched["wall_distances_cm"],
            {"north": 20.0, "south": 120.0, "west": 30.0, "east": 170.0},
        )

    def test_compute_wall_snap_all_four_walls(self) -> None:
        # North wall center: rot=0, z = depth/2 + gap = 30 + 2 = 32
        self.assertEqual(
            room_engine.compute_wall_snap_position(300, 200, 100, 60, wall="north", align="center"),
            (150.0, 32.0, 0.0),
        )
        # South wall center: rot=180, z = 200 - 30 - 2 = 168
        self.assertEqual(
            room_engine.compute_wall_snap_position(300, 200, 100, 60, wall="south", align="center"),
            (150.0, 168.0, 180.0),
        )
        # West wall left(north): rot=270, eff_w=60, eff_d=100 -> x = 30 + 2 = 32, z = 50 + 5 = 55
        self.assertEqual(
            room_engine.compute_wall_snap_position(300, 200, 100, 60, wall="west", align="left"),
            (32.0, 55.0, 270.0),
        )
        # East wall right(south): rot=90, eff_w=60, eff_d=100 -> x = 300 - 30 - 2 = 268, z = 200 - 50 - 5 = 145
        self.assertEqual(
            room_engine.compute_wall_snap_position(300, 200, 100, 60, wall="east", align="right"),
            (268.0, 145.0, 90.0),
        )


class TestLayoutAnalyzer(unittest.TestCase):
    """Tests ergonomic and collision rules in analyze_layout."""

    def _base_state(self, furniture=None, openings=None, structures=None) -> dict:
        return {
            "id": "test",
            "room": {
                "name": "Test",
                "width": 300,
                "depth": 300,
                "height": 240,
                "openings": openings or [],
                "structures": structures or [],
            },
            "furniture": furniture or [],
        }

    def test_clean_layout_is_ok(self) -> None:
        state = self._base_state(
            furniture=[
                {"id": "bed", "type": "bed", "name": "ベッド", "width": 100, "depth": 200, "x": 60, "z": 110, "rotation": 0},
            ]
        )
        res = room_engine.analyze_layout(state)
        self.assertEqual(res["status"], "ok")
        self.assertEqual(res["error_count"], 0)
        self.assertEqual(res["issues"], [])

    def test_out_of_bounds_detected(self) -> None:
        state = self._base_state(
            furniture=[
                {"id": "bed", "type": "bed", "name": "ベッド", "width": 100, "depth": 200, "x": 20, "z": 110, "rotation": 0},
            ]
        )
        res = room_engine.analyze_layout(state)
        self.assertEqual(res["status"], "has_errors")
        self.assertEqual(res["issues"][0]["type"], "out_of_bounds")

    def test_rug_does_not_collide_with_furniture(self) -> None:
        state = self._base_state(
            furniture=[
                {"id": "rug", "type": "rug", "name": "ラグ", "width": 140, "depth": 200, "x": 150, "z": 150, "rotation": 0},
                {"id": "sofa", "type": "sofa", "name": "ソファ", "width": 140, "depth": 80, "x": 150, "z": 150, "rotation": 0},
            ]
        )
        res = room_engine.analyze_layout(state)
        self.assertEqual(res["error_count"], 0)

    def test_table_and_chair_tuck_in_allowed_up_to_20cm(self) -> None:
        # Desk z: 20..80 (center 50, depth 60). Chair z: 65..125 (center 95, depth 60) -> 15cm overlap -> OK
        state = self._base_state(
            furniture=[
                {"id": "d1", "type": "standing_desk", "name": "昇降デスク", "width": 120, "depth": 60, "x": 150, "z": 50, "rotation": 0},
                {"id": "b1", "type": "balance_ball", "name": "バランスボール", "width": 60, "depth": 60, "x": 150, "z": 95, "rotation": 0},
            ]
        )
        res = room_engine.analyze_layout(state)
        self.assertEqual(res["error_count"], 0)

    def test_hinged_door_vs_sliding_door_clearance(self) -> None:
        item = [{"id": "s1", "type": "bookshelf", "name": "棚", "width": 80, "depth": 40, "x": 40, "z": 150, "rotation": 270}]
        # Hinged door on west wall at offset 150 -> blocked!
        hinged_state = self._base_state(
            furniture=item,
            openings=[{"id": "d1", "type": "door", "wall": "west", "offset": 150, "width": 75, "swing": "in-left"}],
        )
        self.assertEqual(room_engine.analyze_layout(hinged_state)["issues"][0]["type"], "door_blocked")

        # Sliding door on west wall at offset 150 -> no swing arc block!
        sliding_state = self._base_state(
            furniture=item,
            openings=[{"id": "d1", "type": "door", "wall": "west", "offset": 150, "width": 75, "swing": "sliding"}],
        )
        self.assertEqual(room_engine.analyze_layout(sliding_state)["issues"], [])

    def test_structure_collision_detected(self) -> None:
        state = self._base_state(
            furniture=[
                {"id": "b1", "type": "bed", "name": "ベッド", "width": 100, "depth": 200, "x": 55, "z": 105, "rotation": 0},
            ],
            structures=[
                {"id": "p1", "name": "北西柱", "kind": "pillar", "x": 25, "z": 20, "width": 50, "depth": 40, "height": 240},
            ],
        )
        res = room_engine.analyze_layout(state)
        self.assertEqual(res["issues"][0]["type"], "structure_collision")

    def test_floor_coverage_excludes_structures_and_tuck_in_overlap(self) -> None:
        # Room 300x300 = 90,000 cm2 (9.0 m2)
        # Structure 100x90 = 9,000 cm2 -> usable_area = 81,000 cm2 (8.1 m2)
        # Desk (100x60 = 6,000) at x=150, z=50 (z: 20..80)
        # Chair (60x60 = 3,600) at x=150, z=90 (z: 60..120) -> 20cm overlap in Z (60x20 = 1,200 cm2 overlap)
        # Exact union of furniture = 6,000 + 3,600 - 1,200 = 8,400 cm2
        # Coverage = 8,400 / 81,000 = 10.37% -> 10.4%
        state = self._base_state(
            furniture=[
                {"id": "d1", "type": "desk", "name": "デスク", "width": 100, "depth": 60, "x": 150, "z": 50, "rotation": 0},
                {"id": "c1", "type": "chair", "name": "チェア", "width": 60, "depth": 60, "x": 150, "z": 90, "rotation": 0},
            ],
            structures=[
                {"id": "st1", "name": "柱", "kind": "pillar", "x": 50, "z": 255, "width": 100, "depth": 90, "height": 240},
            ],
        )
        res = room_engine.analyze_layout(state)
        self.assertEqual(res["room_area_m2"], 9.0)
        self.assertEqual(res["usable_area_m2"], 8.1)
        self.assertEqual(res["floor_coverage_pct"], 10.4)


class TestMultiRoomIsolationAndMCPTools(IsolatedDataTestCase):
    """Verifies room isolation and all MCP tool handlers."""

    def test_room_lifecycle_and_furniture_isolation(self) -> None:
        mcp_server.handle_tool_call(
            "create_room",
            {"room_id": "room_a", "name": "部屋A", "width": 360, "depth": 270, "activate": True},
        )
        mcp_server.handle_tool_call(
            "create_room",
            {"room_id": "room_b", "name": "部屋B", "width": 250, "depth": 350, "activate": False},
        )

        # Add furniture to active room (room_a)
        mcp_server.handle_tool_call("add_furniture", {"preset": "bed_single", "wall": "north"})
        state_a = mcp_server.handle_tool_call("get_room_state", {"room_id": "room_a"})
        state_b = mcp_server.handle_tool_call("get_room_state", {"room_id": "room_b"})
        self.assertEqual(len(state_a["furniture"]), 1)
        self.assertEqual(len(state_b["furniture"]), 0)

        # Switch to room_b and add desk
        mcp_server.handle_tool_call("switch_room", {"room_id": "room_b"})
        self.assertEqual(room_engine.get_active_room_id(), "room_b")
        added = mcp_server.handle_tool_call("add_furniture", {"preset": "standing_desk", "wall": "east"})
        item_id = added["item"]["id"]

        # Update furniture in room_b
        updated = mcp_server.handle_tool_call("update_furniture", {"id": item_id, "x": 120, "z": 180, "rotation": 180})
        self.assertEqual(updated["item"]["x"], 120.0)
        self.assertEqual(updated["item"]["rotation"], 180.0)

        # Apply style theme to room_b
        mcp_server.handle_tool_call("apply_style_theme", {"theme": "japandi", "recolor_furniture": True})
        state_b_after = mcp_server.handle_tool_call("get_room_state", {})
        self.assertEqual(state_b_after["room"]["theme"], "japandi")

        # Room A must still have its nordic theme and only its 1 bed
        state_a_after = mcp_server.handle_tool_call("get_room_state", {"room_id": "room_a"})
        self.assertEqual(state_a_after["room"]["theme"], "nordic")
        self.assertEqual(len(state_a_after["furniture"]), 1)

        # Remove furniture and delete room_b
        mcp_server.handle_tool_call("remove_furniture", {"id": "all"})
        self.assertEqual(len(mcp_server.handle_tool_call("get_room_state", {})["furniture"]), 0)
        mcp_server.handle_tool_call("delete_room", {"room_id": "room_b"})
        self.assertEqual(room_engine.get_active_room_id(), "room_a")

    def test_mcp_stdio_jsonrpc_protocol(self) -> None:
        proc = subprocess.Popen(
            [sys.executable, str(Path(__file__).parent.parent / "mcp_server.py")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
        )
        requests = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05"}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "ping"},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/list"},
            {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "list_catalog", "arguments": {}}},
            {"jsonrpc": "2.0", "id": 5, "method": "unknown_method"},
        ]
        stdout, _ = proc.communicate("\n".join(json.dumps(r) for r in requests) + "\n", timeout=5)
        lines = [json.loads(line) for line in stdout.strip().split("\n") if line.strip()]
        self.assertEqual(len(lines), 5)
        self.assertEqual(lines[0]["id"], 1)
        self.assertEqual(lines[0]["result"]["serverInfo"]["name"], "room-sim-mcp")
        self.assertEqual(lines[1]["id"], 2)
        self.assertEqual(lines[2]["id"], 3)
        self.assertGreaterEqual(len(lines[2]["result"]["tools"]), 12)
        self.assertEqual(lines[3]["id"], 4)
        self.assertFalse(lines[3]["result"]["isError"])
        self.assertEqual(lines[4]["id"], 5)
        self.assertEqual(lines[4]["error"]["code"], -32601)


if __name__ == "__main__":
    unittest.main()

import importlib.util
from pathlib import Path
import unittest

MODULE_PATH = Path(__file__).resolve().parents[1] / "pipeline" / "scripts" / "47_stage_sc.py"
SPEC = importlib.util.spec_from_file_location("stage_sc", MODULE_PATH)
stage_sc = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(stage_sc)


class SouthCarolinaStagingTests(unittest.TestCase):
    def test_stages_source_fields_without_app_classification(self):
        url = "https://example.test/sc/access"
        metadata = {
            "name": "Test layer", "objectIdField": "OBJECTID", "globalIdField": "GlobalID",
            "fields": [{"name": name} for name in stage_sc.SOURCES["access"]["expected_fields"]],
            "editingInfo": {"lastEditDate": 1773761619334}, "copyrightText": "SCDNR",
        }
        rows = [{"attributes": {
            "OBJECTID": 1, "GlobalID": "{ABC-123}", "WaterAccessType": "Boat Ramp",
            "WaterAccessName": "Test Ramp", "Waterbody": "Sample Lake", "Status": "Open",
            "PublicAccess": "Yes", "Latitude": 34.0, "Longitude": -81.0,
        }, "geometry": {"x": -81.0, "y": 34.0}}]

        def fake_request(request_url, params=None):
            if request_url == url:
                return metadata
            if params and params.get("returnIdsOnly"):
                return {"objectIds": [1]}
            return {"features": rows}

        original = stage_sc.request_json
        stage_sc.request_json = fake_request
        try:
            collection, report = stage_sc.normalize_layer("access", {"url": url, "expected_fields": stage_sc.SOURCES["access"]["expected_fields"]}, "2026-10-27T00:00:00Z")
        finally:
            stage_sc.request_json = original

        self.assertEqual(report["record_count_reported"], 1)
        self.assertEqual(report["record_count_staged"], 1)
        self.assertEqual(collection["features"][0]["properties"]["WaterAccessName"], "Test Ramp")
        self.assertNotIn("kind", collection["features"][0]["properties"])
        self.assertFalse(report["reuse_terms_reviewed"])

    def test_rejects_out_of_state_envelope_without_mutating_source_catalogs(self):
        self.assertTrue(stage_sc.in_sc_envelope(-81.0, 34.0))
        self.assertFalse(stage_sc.in_sc_envelope(-85.0, 34.0))
        self.assertFalse(stage_sc.in_sc_envelope(-81.0, 36.0))

    def test_incomplete_page_aborts_staging(self):
        url = "https://example.test/sc/access"
        metadata = {
            "objectIdField": "OBJECTID", "fields": [{"name": name} for name in stage_sc.SOURCES["access"]["expected_fields"]],
        }

        def fake_request(request_url, params=None):
            if request_url == url:
                return metadata
            if params and params.get("returnIdsOnly"):
                return {"objectIds": [1, 2]}
            return {"features": [{"attributes": {"OBJECTID": 1}}]}

        original = stage_sc.request_json
        stage_sc.request_json = fake_request
        try:
            with self.assertRaisesRegex(RuntimeError, "incomplete page"):
                stage_sc.normalize_layer("access", {"url": url, "expected_fields": stage_sc.SOURCES["access"]["expected_fields"]}, "2026-10-27T00:00:00Z")
        finally:
            stage_sc.request_json = original


if __name__ == "__main__":
    unittest.main()

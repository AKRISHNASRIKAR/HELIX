"""Unit tests for scoring.py. Run with `python3 -m unittest` from tests/evaluation."""

import unittest

from scoring import (
    collect_numbers,
    extract_numbers,
    hallucination_report,
    is_traceable,
    percentile,
    score_scenario,
)


class ExtractNumbers(unittest.TestCase):
    def test_ignores_dates_times_versions_and_small_ints(self):
        text = (
            "Revenue dropped on Thursday 2026-10-08 at 08:40 UTC after v2.14.0: "
            "$19,944.04 against an expected $33,117.85 (-39.8%), 5 findings."
        )
        self.assertEqual(extract_numbers(text), [19944.04, 33117.85, -39.8])

    def test_ignores_bookkeeping_counts(self):
        self.assertEqual(extract_numbers("18 finding(s) in total; 1 of 14 agent task(s) failed."), [])

    def test_keeps_decimals_even_when_small(self):
        self.assertEqual(extract_numbers("p = 0.342"), [0.342])


class Traceability(unittest.TestCase):
    def test_rounding_sign_and_percent_forms(self):
        pool = {19944.0412, -39.78, 0.9612}
        self.assertTrue(is_traceable(19944.04, pool))
        self.assertTrue(is_traceable(39.8, pool))  # "39.8% below" vs -39.78
        self.assertTrue(is_traceable(96.1, pool))  # 96.1% vs 0.9612
        self.assertFalse(is_traceable(12345.0, pool))

    def test_collect_numbers_walks_json(self):
        data = {"value": 1.5, "formatted": {"value": "$2,206.30"}, "list": [3, "x 44.5"], "flag": True}
        self.assertEqual(collect_numbers(data), {1.5, 2206.30, 3.0, 44.5})

    def test_report_flags_invented_numbers(self):
        trace = {
            "investigation": {"summary": "Revenue fell to $19,944.04, a 12,000.00 loss."},
            "evidence": [{"data": {"value": 19944.04}, "summary": ""}],
            "findings": [{"id": "f1", "statement": "Revenue was $19,944.04."}],
        }
        report = hallucination_report(trace)
        self.assertEqual(report["numbersChecked"], 3)
        self.assertEqual(report["untracedNumbers"], 1)
        self.assertEqual(report["issues"][0]["untraced"], [12000.0])


class ScoreScenario(unittest.TestCase):
    def trace(self, statement, agents=("ANALYTICS",)):
        return {
            "investigation": {"status": "COMPLETED"},
            "findings": [{"isRootCause": True, "statement": statement, "analyticsType": "DIAGNOSTIC"}],
            "tasks": [{"agentType": a, "status": "SUCCEEDED"} for a in agents],
        }

    def test_passes_on_ground_truth(self):
        expect = {
            "status": ["COMPLETED"],
            "rootCauseDate": ["2026-10-08"],
            "rootCauseMentions": ["web"],
            "rootCauseMentionsWithDeployments": ["web-checkout"],
            "agents": ["ANALYTICS"],
            "agentsWithDeployments": ["PRODUCT"],
        }
        result = score_scenario(
            expect,
            self.trace("Revenue dropped on 2026-10-08: web orders collapsed after web-checkout v2.14.0",
                       agents=("ANALYTICS", "PRODUCT")),
            deployments_connected=True,
        )
        self.assertEqual(result["passed"], result["total"])

    def test_deployment_checks_only_when_connected(self):
        expect = {"status": ["COMPLETED"], "rootCauseMentionsWithDeployments": ["web-checkout"]}
        result = score_scenario(expect, self.trace("x"), deployments_connected=False)
        self.assertEqual(result["total"], 1)

    def test_missing_root_cause_fails_date(self):
        expect = {"status": ["COMPLETED"], "rootCauseDate": ["2026-10-08"]}
        trace = {"investigation": {"status": "COMPLETED"}, "findings": [], "tasks": []}
        result = score_scenario(expect, trace, deployments_connected=False)
        self.assertEqual(result["passed"], 1)


class Percentile(unittest.TestCase):
    def test_interpolates(self):
        self.assertEqual(percentile([1, 2, 3, 4], 0.5), 2.5)
        self.assertIsNone(percentile([], 0.5))


if __name__ == "__main__":
    unittest.main()

"""JobSpec (ARCHITECTURE section 8): every refusal below is a born-failing case, and the allow-lists are pinned to
the sources they must equal (run_base.FEEDS, strategies.registry.STRATEGIES, the in-sample fence). `run_base.py` is
parsed, never imported or run.
"""
from __future__ import annotations

import ast
import json
from datetime import date

import pytest
from pydantic import ValidationError

from nq_lab import config, data
from nq_lab.strategies.registry import STRATEGIES
from nq_terminal.models import jobs as jm
from nq_terminal.models.jobs import JobSpec

from p2_jobs_fakes import spec_dict

RUN_BASE = config.ROOT / "backtests" / "run_base.py"
TICKS = {"ticks": 1}
MINIMAL_PARAMS = {"za_orb": {"or_minutes": 5}, "overnight": {}, "volmanaged": TICKS, "volmanaged_bh": TICKS,
                  "tsmom": TICKS, "dtsmom": {"ticks": 1, "book": "tsmom"}, "eomtsy": TICKS}


def feeds_keys() -> set[str]:
    """The keys of the FEEDS dict literal in backtests/run_base.py, read from its syntax tree."""
    tree = ast.parse(RUN_BASE.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "FEEDS" for t in node.targets):
            assert isinstance(node.value, ast.Dict)
            return {k.value for k in node.value.keys if isinstance(k, ast.Constant)}
    raise AssertionError("FEEDS not found in run_base.py")


def refused(**overrides) -> ValidationError:
    with pytest.raises(ValidationError) as caught:
        JobSpec.model_validate(spec_dict(**overrides))
    return caught.value


def test_strategy_names_equal_the_run_base_feeds() -> None:
    assert set(jm.STRATEGY_NAMES) == feeds_keys() == set(STRATEGIES)


def test_variants_equal_the_data_layer_variants() -> None:
    assert set(jm.VARIANTS) == set(data.EXCLUDE_BY_VARIANT)


def test_window_bounds_equal_the_in_sample_fence() -> None:
    assert jm.IN_SAMPLE_START == config.IS_START.date() == date(2010, 1, 1)
    assert jm.IN_SAMPLE_END == config.IS_END.date() == date(2022, 1, 1)


@pytest.mark.parametrize("strategy", sorted(MINIMAL_PARAMS))
def test_a_valid_spec_for_every_strategy(strategy: str) -> None:
    spec = JobSpec.model_validate(spec_dict(strategy=strategy, params=MINIMAL_PARAMS[strategy]))
    assert spec.strategy == strategy and spec.params == MINIMAL_PARAMS[strategy]


def test_the_fence_dates_themselves_are_allowed() -> None:
    spec = JobSpec.model_validate(spec_dict(start="2010-01-01", end="2022-01-01"))
    assert (spec.start, spec.end) == (date(2010, 1, 1), date(2022, 1, 1))


def test_extra_keys_are_refused() -> None:
    assert "extra_forbidden" in {e["type"] for e in refused(shell=True).errors()}


@pytest.mark.parametrize("params", [
    {"or_minutes": "5; rm -rf /"}, {"or_minutes": "$(whoami)"}, {"or_minutes": "`id`"}, {"or_minutes": "a && b"},
    {"or_minutes": "a|b"}, {"or_minutes": "a b"}, {"or_minutes": 'a"b'}, {"or_minutes": "a'b"},
    {"or_minutes": "a\nb"}, {"or_minutes": "%PATH%"}, {"or_minutes": "..\\..\\x"}, {"or_minutes": "a>out"},
    {"or_minutes; calc": 5}, {"or_minutes": ["ok", "no good"]}, {"or_minutes": {"nested": "x;y"}}])
def test_shell_metacharacters_in_params_are_refused(params: dict) -> None:
    refused(strategy="za_orb", params=params)


@pytest.mark.parametrize("strategy", ["evil", "", "ZA_ORB", "za_orb ", "../za_orb", "za_orb;calc", None, 5])
def test_an_unknown_strategy_is_refused(strategy) -> None:
    refused(strategy=strategy)


@pytest.mark.parametrize("run_id", [
    "t_a/b", "t_a\\b", "t_..\\x", "t_a/../b", "/t_a", "C:\\t_a", "t_", "t_" + "x" * 81, "x_ok", "T_ok", "t_a b",
    "t_ok\n", "t_a;b", "t_é", "", "..", "t_a:b", None, 7])
def test_a_run_id_must_match_the_pattern(run_id) -> None:
    refused(run_id=run_id)


def test_the_longest_run_id_is_allowed() -> None:
    assert JobSpec.model_validate(spec_dict(run_id="t_" + "x" * 80)).run_id.startswith("t_")


@pytest.mark.parametrize("end", ["2022-01-02", "2022-06-30", "2026-09-26", "2099-01-01"])
def test_an_end_past_the_fence_is_refused(end: str) -> None:
    assert "end" in {str(e["loc"][-1]) for e in refused(end=end).errors()}


@pytest.mark.parametrize("start", ["2009-12-31", "2000-01-01", "1970-01-01"])
def test_a_start_before_the_in_sample_window_is_refused(start: str) -> None:
    refused(start=start)


def test_start_must_be_before_end() -> None:
    refused(start="2015-01-01", end="2015-01-01")
    refused(start="2016-01-01", end="2015-01-01")


@pytest.mark.parametrize("value", ["2015-1-1", "20150101", "2015-01-01T00:00:00", "2015-01-01 ", 1420070400,
                                   "yesterday", None, 20150101.0])
def test_dates_must_be_plain_iso_dates(value) -> None:
    refused(start=value)
    refused(end=value)


def test_variant_is_one_of_the_data_variants() -> None:
    refused(variant="raw")
    refused(variant="repaired; x")


def test_a_param_the_strategy_does_not_have_is_refused() -> None:
    refused(strategy="overnight", params={"or_minutes": 5})
    refused(strategy="za_orb", params={"nope": 1})


@pytest.mark.parametrize("key", ["lookahead_probe", "instrument_id", "bar_type", "instrument_ids", "bar_types"])
def test_probe_and_runner_assigned_params_are_refused(key: str) -> None:
    refused(strategy="dtsmom", params={"ticks": 1, key: "x"})


def test_the_allowed_names_are_the_struct_fields_plus_the_feed_keys() -> None:
    for name, (_, config_cls) in STRATEGIES.items():
        allowed = jm.allowed_param_names(name)
        assert set(config_cls.__struct_fields__) - set(jm.RUNNER_SET_PARAMS) - jm.engine_base_fields() <= allowed
        assert allowed <= set(config_cls.__struct_fields__) | set(jm.FEED_PARAM_KEYS.get(name, ()))
        assert set(jm.FEED_PARAM_KEYS.get(name, ())) <= allowed
        assert not allowed & set(jm.RUNNER_SET_PARAMS) and "lookahead_probe" not in allowed


@pytest.mark.parametrize("strategy", ["volmanaged", "volmanaged_bh", "tsmom", "dtsmom", "eomtsy"])
@pytest.mark.parametrize("ticks", [-1, 3, True, False, 1.0, "1", None, [1]])
def test_the_cost_levels_are_checked_for_the_feeds_that_need_them(strategy: str, ticks) -> None:
    refused(strategy=strategy, params={"ticks": ticks})


@pytest.mark.parametrize("strategy", ["volmanaged", "volmanaged_bh", "tsmom", "dtsmom", "eomtsy"])
def test_ticks_is_required_where_the_feed_needs_it(strategy: str) -> None:
    refused(strategy=strategy, params={})


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf"), 10**30, [[1, [2, [3]]]],
                                   list(range(100)), {"a": {"b": {"c": 1}}}, object()])
def test_param_values_are_small_finite_json(value) -> None:
    refused(strategy="za_orb", params={"or_minutes": value})


def test_the_config_json_stays_small() -> None:
    refused(strategy="za_orb", params={f"k{i}": 1 for i in range(400)})


def test_nan_in_a_json_body_is_refused() -> None:
    body = json.dumps(spec_dict(strategy="za_orb", params={"or_minutes": 5})).replace("5}", "NaN}")
    with pytest.raises(ValidationError):
        JobSpec.model_validate_json(body)


def test_config_dict_is_the_run_base_config_in_its_key_order() -> None:
    spec = JobSpec.model_validate(spec_dict(strategy="za_orb", params={"or_minutes": 5, "target_r": 10.0}))
    cfg = jm.run_config(spec)
    assert list(cfg) == ["strategy", "params", "variant", "start", "end", "run_id"]
    assert cfg["start"] == "2010-09-28" and cfg["end"] == "2022-01-01"
    assert json.loads(json.dumps(cfg)) == cfg


def test_job_models_declare_every_field_required() -> None:
    schema = jm.Job.model_json_schema(mode="serialization")
    assert set(schema["required"]) >= {"id", "run_id", "state", "spec", "created", "started", "finished",
                                       "exit_code", "message", "log_tail"}


# The in-sample fence must hold for the calendar keys and the runner-derived fields too: a request that the research
# rules would refuse is refused before a process is started (ARCHITECTURE section 9).
CALENDAR_TICKS = {"ticks": 1}


@pytest.mark.parametrize("strategy", ["tsmom", "dtsmom"])
@pytest.mark.parametrize("value", ["2022-01-01", "2026-01-01", "2021-13-01", "2021-1-1", "tomorrow", 20211231,
                                   [2021, 12, 31], True, None])
def test_end_date_must_be_an_iso_date_inside_the_fence(strategy: str, value) -> None:
    refused(strategy=strategy, params={**CALENDAR_TICKS, "end_date": value})


@pytest.mark.parametrize("strategy", ["tsmom", "dtsmom", "eomtsy"])
@pytest.mark.parametrize("key", ["first_month", "last_month"])
@pytest.mark.parametrize("value", [[2026, 3], [2022, 1], [2009, 12], [2021, 13], [2021, 0], [2021], [2021, 3, 1],
                                   ["2021", 3], [True, 3], [2021.0, 3], 2021, "2021-03", [[2021, 3]]])
def test_the_month_keys_are_year_month_pairs_inside_the_fence(strategy: str, key: str, value) -> None:
    refused(strategy=strategy, params={**CALENDAR_TICKS, key: value})


def test_the_issue_reproduction_is_refused() -> None:
    refused(strategy="tsmom", start="2010-01-01", end="2022-01-01",
            params={"ticks": 1, "end_date": "2026-01-01", "last_month": [2026, 3]})


@pytest.mark.parametrize("strategy", ["tsmom", "dtsmom"])
def test_calendar_values_inside_the_fence_are_allowed(strategy: str) -> None:
    params = {**CALENDAR_TICKS, "first_month": [2011, 12], "last_month": [2021, 11], "end_date": "2021-12-31"}
    assert JobSpec.model_validate(spec_dict(strategy=strategy, params=params)).params == params


def test_the_fence_month_edges_are_allowed() -> None:
    params = {**CALENDAR_TICKS, "first_month": [2010, 1], "last_month": [2021, 12]}
    JobSpec.model_validate(spec_dict(strategy="eomtsy", params=params))


# What run_base's feeds derive from the data, and the Nautilus base-config fields, are not the requester's to set.
RUNNER_DERIVED = {"za_orb": ["sessions"], "overnight": ["sessions"],
                  "volmanaged": ["end_ns", "sessions"], "volmanaged_bh": ["end_ns", "t0_ns", "sessions"],
                  "tsmom": ["end_ns", "sessions", "formations"], "dtsmom": ["days", "mult"],
                  "eomtsy": ["days", "mult", "roots"]}
ENGINE_BASE = ["strategy_id", "order_id_tag", "oms_type", "manage_stop", "external_order_claims", "log_events",
               "log_commands", "manage_gtd_expiry", "manage_contingent_orders", "market_exit_max_attempts"]


@pytest.mark.parametrize("strategy", sorted(RUNNER_DERIVED))
def test_runner_derived_fields_are_refused(strategy: str) -> None:
    for key in RUNNER_DERIVED[strategy]:
        refused(strategy=strategy, params={**MINIMAL_PARAMS[strategy], key: 1})


@pytest.mark.parametrize("strategy", sorted(MINIMAL_PARAMS))
@pytest.mark.parametrize("key", ENGINE_BASE)
def test_nautilus_base_config_fields_are_refused(strategy: str, key: str) -> None:
    refused(strategy=strategy, params={**MINIMAL_PARAMS[strategy], key: 1})

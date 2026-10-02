"""SV3b and SV8 step 8 as response models (ANALYTICS_CATALOG SV3b and SV8): the dicts of `analytics/neff.py` with
their labels. Pure; the callers (`tearsheet_extended.deflated_view`, `spa_family`) pass what they already computed.
"""
from __future__ import annotations

from collections.abc import Sequence

from nq_terminal.analytics import neff
from nq_terminal.models.neff import (
    EffectiveNDsr,
    EffectiveNEstimate,
    EffectiveNRefusal,
    EffectiveNView,
    EffectiveNWindow,
    SpaEffectiveMembers,
    SpaEffectiveRefusal,
    SpaStrongestPair,
)
from nq_terminal.services.tearsheet import num

CONSTRUCTION = "ANALYTICS_CATALOG section 7, SV3b construction"
NOTE = ("Pearson correlation of the daily trials on the sessions they all record, with the eigenvalue participation "
        "ratio, the Li and Ji (2005) count and average-linkage clusters at 1 - rho 0.5 as three estimates of N, and "
        "the SR0 and DSR each sets under the served null variance V0; the monthly books are counted as independent "
        "trials. A smaller N lowers SR0 and raises every DSR, so this view errs towards flattering a trial: the "
        "served N row stays the frozen reading and this is read beside it. The correlation is of returns on the "
        "common window, not of how the trials were chosen, and the three estimators can disagree. An extra view "
        "only: it never overrides a frozen pass bar and gives no verdict")


def effective_n_view(trials: Sequence, found: dict) -> EffectiveNView:
    """SV3b over the registered trials and the SV3 result computed for them."""
    got = neff.effective_trials(trials, found)
    refusal, window = got["refusal"], got["window"]
    return EffectiveNView(
        construction=CONSTRUCTION, note=NOTE, cluster_cut=neff.CLUSTER_CUT,
        min_common_sessions=neff.MIN_COMMON_SESSIONS, daily=got["daily"], monthly=got["monthly"],
        refusal=None if refusal is None else EffectiveNRefusal(**refusal),
        window=None if window is None else EffectiveNWindow(**window),
        correlation=got["correlation"], eigenvalues=got["eigenvalues"], clusters=got["clusters"],
        sequence=got["sequence"],
        estimates=[EffectiveNEstimate(id=e["id"], n_daily=e["n_daily"], n_total=e["n_total"],
                                      sr0_session=num(e["sr0_session"]), sr0_annual=num(e["sr0_annual"]),
                                      served=e["served"]) for e in got["estimates"]],
        dsr=[EffectiveNDsr(name=d["name"], periods=d["periods"], served=num(d["served"]),
                           participation=num(d["participation"]), li_ji=num(d["li_ji"]), clusters=num(d["clusters"]))
             for d in got["dsr"]])


def effective_members_view(correlation, names: Sequence[str]) -> SpaEffectiveMembers:
    """SV8 step 8 over a row's correlation of the loss differentials, k by k in the order of `names`."""
    got = neff.effective_members(correlation, names)
    refusal, pair = got["refusal"], got["strongest"]
    return SpaEffectiveMembers(
        k=got["k"], cut=got["cut"], refusal=None if refusal is None else SpaEffectiveRefusal(**refusal),
        participation=num(got["participation"]), li_ji=num(got["li_ji"]), clusters=got["clusters"],
        strongest=None if pair is None else SpaStrongestPair(**pair))

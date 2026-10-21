"""Reporting: ACTUAL performance (broker records), evidence-gated FORECAST ranges and
hypothetical SCENARIO arithmetic. Each result carries a ``kind`` label so the dashboard can
never present one as another."""

from .forecast import INSUFFICIENT, EvidenceGate, evidence_gate, forecast
from .performance import daily_returns_pct, drawdown, next_trading_days, period_summary, risk_allowance
from .scenario import assess_target, observed_evidence, render_markdown

__all__ = ["INSUFFICIENT", "EvidenceGate", "evidence_gate", "forecast", "daily_returns_pct", "drawdown",
           "next_trading_days", "period_summary", "risk_allowance", "assess_target", "observed_evidence",
           "render_markdown"]

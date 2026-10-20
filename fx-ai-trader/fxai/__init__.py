"""fxai - risk-first, AI-assisted FX trading system for MetaTrader 4.

The package is organised so that every order passes through the deterministic
risk engine (``fxai.risk``) and then the MT4 EA's own hard guard. Strategy,
ML and LLM components can only *propose* or *veto*; they cannot size trades,
change limits or bypass checks.
"""

__version__ = "1.0.0"
PROTOCOL_VERSION = 1

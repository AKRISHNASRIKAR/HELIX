"""HELIX Product Agent (Phase 7). See README.md."""

__version__ = "0.1.0"

from .agent import CAPABILITIES, ProductAgent, event_confidence  # noqa: E402

__all__ = ["__version__", "CAPABILITIES", "ProductAgent", "event_confidence"]

"""Re-export of the BaseAgent contract.

BaseAgent now lives in `helix_contracts.agent_base` so agents/* packages can
implement it without depending on this service. This module keeps the old
import path (`app.agents.base.BaseAgent`) working.
"""

from helix_contracts.agent_base import BaseAgent

__all__ = ["BaseAgent"]

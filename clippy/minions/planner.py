from .base_minion import BaseMinion
from dataclasses import dataclass


@dataclass
class Planner(BaseMinion):
    """
    The minion responsible for:
    - Creating the initial plan
    - Updating the plan when there's the report from a task
    - Updating the context when there's the report from a task
    """

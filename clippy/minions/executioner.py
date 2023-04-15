from base_minion import BaseMinion
from dataclasses import dataclass


@dataclass
class Executioner(BaseMinion):
    """
    The minion responsible for executing a task.
    Can be specialized for different types of tasks (research, operations, code writing).
    """

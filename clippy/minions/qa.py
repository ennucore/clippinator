from .base_minion import BaseMinion
from dataclasses import dataclass


@dataclass
class QA(BaseMinion):
    """
    The minion responsible for assessing the quality of a result of a task
    """

from .base_minion import BaseMinion
from dataclasses import dataclass
from clippy.project import Project


@dataclass
class Executioner(BaseMinion):
    """
    The minion responsible for executing a task.
    Can be specialized for different types of tasks (research, operations, code writing).
    """

    def execute(self, task: str, project: Project) -> str:
        raise NotImplementedError

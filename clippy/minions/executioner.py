from .base_minion import BaseMinion
from dataclasses import dataclass
from clippy.project import Project
from .prompts import execution_prompt
from clippy import tools


class Executioner:
    """
    The minion responsible for executing a task.
    Can be specialized for different types of tasks (research, operations, code writing).
    """
    execution_agent: BaseMinion

    def __init__(self, project: Project):
        self.execution_agent = BaseMinion(execution_prompt, tools.get_tools(project))

    def execute(self, task: str, project: Project) -> str:
        return self.execution_agent.run(task=task, **project.prompt_fields())

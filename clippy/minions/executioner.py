from .base_minion import BaseMinion
from clippy.project import Project
from .prompts import execution_prompt, get_specialized_prompt
from clippy import tools
import yaml


class Executioner:
    """
    The minion responsible for executing a task.
    Can be specialized for different types of tasks (research, operations, code writing).
    """
    execution_agent: BaseMinion

    def __init__(self, project: Project):
        self.execution_agent = BaseMinion(execution_prompt, tools.get_tools(project))

    def execute(self, task: str, project: Project, milestone: str = '') -> str:
        return self.execution_agent.run(task=task, milestone=milestone, **project.prompt_fields())


class SpecializedExecutioner(Executioner):
    name: str
    description: str

    @classmethod
    def expl(cls) -> str:
        return f'    @{cls.name} - {cls.description}\n'


def specialized_executioner(name: str, description: str, prompt: str, tool_names: list[str]):
    class SpecializedExecutionerN(SpecializedExecutioner):
        def __init__(self, project: Project):
            super().__init__(project)
            all_tools = tools.get_tools(project)
            spe_tools = [tool for tool in all_tools if tool.name in tool_names]
            self.execution_agent = BaseMinion(get_specialized_prompt(prompt), spe_tools)
            self.name = name
            self.description = description

        @classmethod
        def expl(cls) -> str:
            return f'    @{name} - {description}\n'

    SpecializedExecutionerN.__name__ = name
    return SpecializedExecutionerN


def get_specialized_executioners(project) -> dict[str, SpecializedExecutioner]:
    with open('clippy/minions/specialized_minions.yaml') as f:
        data = yaml.load(f, Loader=yaml.FullLoader)
        return {line['name']: specialized_executioner(**line)(project)
                for line in data}

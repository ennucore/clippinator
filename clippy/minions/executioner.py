import yaml

from clippy import tools
from clippy.project import Project
from .base_minion import BaseMinion, BaseMinionOpenAI
from .prompts import execution_prompt, get_specialized_prompt
from ..tools.subagents import DeclareArchitecture


class Executioner:
    """
    The minion responsible for executing a task.
    Can be specialized for different types of tasks (research, operations, code writing).
    """
    execution_agent: BaseMinion | BaseMinionOpenAI

    def __init__(self, project: Project, use_openai: bool = True):
        if use_openai:
            self.execution_agent = BaseMinionOpenAI(execution_prompt, tools.get_tools(project, True))
        else:
            self.execution_agent = BaseMinion(execution_prompt, tools.get_tools(project))

    def execute(self, task: str, project: Project, milestone: str = '') -> str:
        return self.execution_agent.run(task=task, milestone=milestone, **project.prompt_fields())


class SpecializedExecutioner(Executioner):
    name: str
    description: str

    @classmethod
    def expl(cls) -> str:
        return f'    @{cls.name} - {cls.description}\n'


def specialized_executioner(name: str, description: str, prompt: str,
                            tool_names: list[str], use_openai_functions: bool = True):
    class SpecializedExecutionerN(SpecializedExecutioner):
        def __init__(self, project: Project):
            super().__init__(project)
            all_tools = tools.get_tools(project, use_openai_functions) + [DeclareArchitecture(project).get_tool()]
            spe_tools = [tool for tool in all_tools if tool.name in tool_names or tool.name == 'Python']
            if use_openai_functions:
                self.execution_agent = BaseMinionOpenAI(get_specialized_prompt(prompt), spe_tools)
            else:
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
        return {line['name']: specialized_executioner(**{k.replace('-', '_'): v for k, v in line.items()})(project)
                for line in data}

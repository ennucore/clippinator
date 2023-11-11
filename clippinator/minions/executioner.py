import yaml

from clippinator import tools
from clippinator.project import Project
from .base_minion import BaseMinion, BaseMinionOpenAI
from .prompts import execution_prompt, get_specialized_prompt
from ..tools.architectural import DeclareArchitecture


class Executioner:
    """
    The minion responsible for executing a task.
    Can be specialized for different types of tasks (research, operations, code writing).
    """
    execution_agent: BaseMinion | BaseMinionOpenAI

    def __init__(self, project: Project, use_openai: bool = True, allow_feedback: bool = False):
        if use_openai:
            self.execution_agent = BaseMinionOpenAI(execution_prompt, tools.get_tools(project, True))
        else:
            self.execution_agent = BaseMinion(execution_prompt, tools.get_tools(project), allow_feedback=allow_feedback)

    def execute(self, task: str, project: Project, milestone: str = '', **kwargs) -> str:
        return self.execution_agent.run(task=task, milestone=milestone, **project.prompt_fields(), **kwargs)


class SpecializedExecutioner(Executioner):
    name: str
    description: str

    @classmethod
    def expl(cls) -> str:
        return f'    @{cls.name} - {cls.description}\n'


def specialized_executioner(name: str, description: str, prompt: str,
                            tool_names: list[str], model: str = 'gpt-4-1106-preview',
                            use_openai_functions: bool = True, allow_feedback: bool = False):
    class SpecializedExecutionerN(SpecializedExecutioner):
        def __init__(self, project: Project):
            super().__init__(project)
            all_tools = tools.get_tools(project, use_openai_functions) + [DeclareArchitecture(project).get_tool()]
            spe_tools = [tool for tool in all_tools if tool.name in tool_names]
            if use_openai_functions:
                self.execution_agent = BaseMinionOpenAI(get_specialized_prompt(prompt), spe_tools)
            else:
                self.execution_agent = BaseMinion(get_specialized_prompt(prompt), spe_tools,
                                                  allow_feedback=allow_feedback, model=model)
            self.name = name
            self.description = description

        @classmethod
        def expl(cls) -> str:
            return f'    @{name} - {description}\n'

    SpecializedExecutionerN.__name__ = name
    return SpecializedExecutionerN


def get_specialized_executioners(project) -> dict[str, SpecializedExecutioner]:
    with open('clippinator/minions/specialized_minions.yaml') as f:
        data = yaml.load(f, Loader=yaml.FullLoader)
        return {line['name']: specialized_executioner(**{k.replace('-', '_'): v for k, v in line.items()})(project)
                for line in data}

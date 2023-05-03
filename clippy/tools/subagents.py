from clippy.minions.executioner import SpecializedExecutioner, Executioner
from clippy.project import Project
from .tool import SimpleTool
from ..minions import extract_agent_name


class Subagent(SimpleTool):
    name = "Subagent"
    description = (
        "call subagents to perform tasks. Use 'Action: Subagent' for the general agent "
        "or 'Action: Subagent @AgentName', for example 'Action: Subagent @Writer'"
    )

    def __init__(self, project: Project, agents: dict[str, SpecializedExecutioner], default: Executioner):
        self.agents = agents
        self.default = default
        self.project = project
        super().__init__()

    def func(self, args: str) -> str:
        task, agent = extract_agent_name(args)
        print(f'Running task "{task}" with agent "{agent}"')
        runner = self.agents.get(agent, self.default)
        return runner.execute(task, self.project)

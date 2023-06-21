from __future__ import annotations

import typing

from clippy.project import Project
from .terminal import get_pids, end_sessions
from .tool import SimpleTool
from ..minions import extract_agent_name

if typing.TYPE_CHECKING:
    from clippy.minions.executioner import SpecializedExecutioner, Executioner


class Subagent(SimpleTool):
    name = "Subagent"
    description = (
        "call subagents to perform tasks. Use 'Action: Subagent' for the general agent "
        "or 'Action: Subagent @AgentName', for example 'Action: Subagent @Writer'"
    )

    def __init__(
            self,
            project: Project,
            agents: dict[str, SpecializedExecutioner],
            default: Executioner,
    ):
        self.agents = agents
        self.default = default
        self.project = project
        super().__init__()

    def func(self, args: str) -> str:
        pids = get_pids()
        task, agent = extract_agent_name(args)
        if agent.strip() and agent not in self.agents:
            return f"Unknown agent '{agent}', please choose from: {', '.join(self.agents.keys())}"
        runner = self.agents.get(agent, self.default)
        prev_memories = self.project.memories.copy()
        print(
            f'Running task "{task}" with agent "{getattr(runner, "name", "default")}"'
        )
        try:
            result = runner.execute(task, self.project)
        except Exception as e:
            raise e
            result = f"Error running agent, retry with another task or agent: {e}"
        new_memories = [mem for mem in self.project.memories if mem not in prev_memories]
        if agent == "Architect":
            result = 'Architecture declared: ' + self.project.architecture + '\n'
        result = f'Completed, result: {result}\n' \
                 f'Current project state:\n{self.project.get_project_summary()}\n'
        if new_memories:
            result += 'New memories:\n  - ' + '\n  - '.join(new_memories)
        end_sessions(pids)
        return result


class DeclareArchitecture(SimpleTool):
    name = "DeclareArchitecture"
    description = "declare the architecture of the project for the subagents"

    def __init__(self, project: Project):
        self.project = project
        super().__init__()

    def func(self, args: str) -> str:
        self.project.architecture = args
        return f"Architecture declared."


class Remember(SimpleTool):
    name = "Remember"
    description = "remember a fact for later use which will be known globally " \
                  "(e.g. some bugs, implementation details, something to be done later, etc.)"

    def __init__(self, project: Project):
        self.project = project
        super().__init__()

    def func(self, args: str) -> str:
        self.project.memories.append(args)
        self.project.memories = self.project.memories[-10:]
        return f"Remembered {args}."

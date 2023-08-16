from __future__ import annotations

import typing

from clippinator.project import Project
from .terminal import get_pids, end_sessions
from .tool import SimpleTool
from .utils import trim_extra, get_input_from_editor, yes_no_prompt
from ..minions import extract_agent_name

if typing.TYPE_CHECKING:
    from clippinator.minions.executioner import SpecializedExecutioner, Executioner


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
            result = f"Error running agent, retry with another task or agent: {e}"
        result = trim_extra(result, 1200)
        new_memories = [mem for mem in self.project.memories if mem not in prev_memories]
        if agent == "Architect":
            if yes_no_prompt('Do you want to edit the project architecture?'):
                self.project.architecture = get_input_from_editor(self.project.architecture)
            result = 'Architecture declared: ' + self.project.architecture + '\n'
        result = f'Completed, result: {result}\n\n' \
                 f'Current project state:\n{self.project.get_project_summary()}\n'
        if new_memories:
            result += 'New memories:\n  - ' + '\n  - '.join(new_memories)
        end_sessions(pids)
        return result

from __future__ import annotations

from dataclasses import dataclass, field

from .base_minion import BaseMinion
from .prompts import update_planning, initial_planning
from clippy.project import Project


@dataclass
class Plan:
    milestones: list[str]
    first_milestone_tasks: list[str]
    completed_milestones: list[str] = field(default_factory=list)
    completed_tasks: list[str] = field(default_factory=list)

    @classmethod
    def parse(cls, plan: str) -> Plan:
        """
        Parse the plan from a string to the class. The format is as following:
        1. Milestone 1
            - Task 1
            - Task 2
        2. Milestone 2
        3. Milestone 3
        4. Milestone 4
        """
        milestones = []
        first_milestone_tasks = []
        for line in plan.splitlines():
            line = line.strip()
            if line.startswith('- '):
                first_milestone_tasks.append(line[2:].removeprefix('[ ]').strip())
            elif line and '.' in line[:5]:
                milestones.append(line.split('.', 1)[1].strip())
        return cls(milestones, first_milestone_tasks)

    def __str__(self) -> str:
        res = ''
        if self.completed_milestones:
            res += f'Completed milestones:\n'
            for milestone in self.completed_milestones:
                res += f'    - {milestone}\n'
        for i, milestone in enumerate(self.milestones):
            res += f'{i + 1}. {milestone}\n'
            if i == 0:
                for completed_task in self.completed_tasks:
                    res += f'    - [x] {completed_task}\n'
                for task in self.first_milestone_tasks:
                    res += f'    - [ ] {task}\n'
        return res


@dataclass
class Planner(BaseMinion):
    """
    The minion responsible for:
    - Creating the initial plan
    - Updating the plan when there's the report from a task
    - Updating the context when there's the report from a task
    """

    def create_initial_plan(self, project: Project) -> Plan:
        return Plan.parse(self.run(**project.prompt_fields()))

    def update_plan(self, plan: Plan, report: str, project: Project) -> Plan:
        return Plan.parse(self.run(**project.prompt_fields(), report=report, plan=str(plan)))

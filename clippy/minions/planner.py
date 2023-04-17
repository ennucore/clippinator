from .base_minion import BaseMinion
from dataclasses import dataclass
from .planner_prompt import update_planning, initial_planning
from clippy.project import Project


@dataclass
class Plan:
    milestones: list[str]
    first_milestone_tasks: list[str]


@dataclass
class Planner(BaseMinion):
    """
    The minion responsible for:
    - Creating the initial plan
    - Updating the plan when there's the report from a task
    - Updating the context when there's the report from a task
    """

    def create_initial_plan(self, project: Project) -> Plan:
        pass

    def update_plan(self, plan: Plan, report: str, project: Project) -> Plan:
        pass

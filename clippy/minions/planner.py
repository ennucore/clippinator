from __future__ import annotations

from dataclasses import dataclass, field

import typing
from typing import Tuple

from .base_minion import BasicLLM, FeedbackMinion
from .prompts import (
    architecture_prompt,
    planning_prompt,
    update_planning_prompt,
    update_architecture_prompt,
    planning_evaluation_prompt,
    architecture_evaluation_prompt,
    feedback_prompt,
)
from clippy.project import Project

# from clippy import tools
from rich.progress import Progress, SpinnerColumn, TextColumn


@dataclass
class Plan:
    milestones: list[str]
    first_milestone_tasks: list[str]
    completed_milestones: list[str] = field(default_factory=list)
    completed_tasks: list[str] = field(default_factory=list)

    @classmethod
    def parse(cls, plan: str, raise_errors: bool = True) -> Plan:
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
            if "[x]" in line:
                continue
            if line.startswith("- "):
                first_milestone_tasks.append(line[2:].removeprefix("[ ]").strip())
            elif line and "." in line[:5]:
                milestones.append(line.split(".", 1)[1].strip())

        if not milestones and raise_errors:
            raise ValueError("No milestones found. Pay attention to the format - the milestones are numbered items.")
        if len(milestones) > 5 and raise_errors:
            raise ValueError("Too many milestones (the numbered items) found, there should be less than 6 numbered items.")

        if not first_milestone_tasks:
            if raise_errors:
                raise ValueError("No tasks for the first milestone found. The tasks are the bulleted items "
                                 "after the first milestone (after 1.).")
            first_milestone_tasks = [milestones[0]]
        if len(first_milestone_tasks) > 22 and raise_errors:
            raise ValueError("Too many tasks for the first milestone found, there should be <23.")
        return cls(milestones, first_milestone_tasks)

    def display_progress(self):
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            transient=True,
        ) as progress:
            # Display completed milestones
            for milestone in self.completed_milestones:
                progress.add_task(description=milestone, completed=True)

            # Display current milestone with spinner
            current_milestone = self.milestones[0]
            _milestone_task = progress.add_task(
                description=current_milestone, total=None
            )

            # Display completed tasks for current milestone
            for task in self.completed_tasks:
                progress.add_task(description="  " + task, completed=True)

            # Display current task with spinner
            current_task = self.first_milestone_tasks[0]
            _task = progress.add_task(description="  " + current_task, total=None)

            # Display next tasks for current milestone
            for task in self.first_milestone_tasks[1:]:
                progress.add_task(description="  " + task, completed=False, start=False)

            # Display next milestones
            for milestone in self.milestones[1:]:
                progress.add_task(description=milestone, completed=False, start=False)

    def __str__(self) -> str:
        res = ""
        if self.completed_milestones:
            res += f"Completed milestones:\n"
            for milestone in self.completed_milestones:
                res += f"    - {milestone}\n"
        for i, milestone in enumerate(self.milestones):
            res += f"{i + 1}. {milestone}\n"
            if i == 0:
                for completed_task in self.completed_tasks:
                    res += f"    - [x] {completed_task}\n"
                for task in self.first_milestone_tasks:
                    res += f"    - {task}\n"
        return res


def split_context(result: str, raise_errors: bool = True) -> typing.Tuple[str, Plan]:
    """
    Parse the model output and return the context and the plan
    """
    if "CONTEXT:" not in result and raise_errors:
        raise ValueError(
            f"Context not found in the result. It needs to go after 'CONTEXT:'"
        )
    if "FINAL PLAN:" not in result.split("CONTEXT:", 1)[-1].strip() and raise_errors:
        raise ValueError(
            f"Final plan not found in the result. It needs to go after 'FINAL PLAN:'"
        )
    result = result.split("CONTEXT:", 1)[-1].strip()
    context, plan = result.split("FINAL PLAN:", 1)
    plan = plan.strip()
    return context, Plan.parse(plan)


def extract_after_keyword(string: str, keyword: str, raise_errors: bool = False) -> str:
    """
    Extract the string after the keyword
    """
    if keyword not in string and raise_errors:
        raise ValueError(f"Keyword '{keyword}' not found in the result.")
    return string.split(keyword, 1)[-1].strip()


class Planner:
    """
    The minion responsible for:
    - Creating the initial plan
    - Updating the plan when there's the report from a task
    - Updating the context when there's the report from a task
    """

    initial_architect: FeedbackMinion
    initial_planner: FeedbackMinion
    update_planner: FeedbackMinion
    update_architect: FeedbackMinion

    def __init__(self, _project: Project):
        self.initial_planner = FeedbackMinion(
            BasicLLM(planning_prompt),
            planning_evaluation_prompt,
            feedback_prompt,
            lambda result: split_context(result),
        )
        self.initial_architect = FeedbackMinion(
            BasicLLM(architecture_prompt),
            architecture_evaluation_prompt,
            feedback_prompt,
            lambda result: extract_after_keyword(result, "FINAL ARCHITECTURE:"),
        )
        self.update_planner = FeedbackMinion(
            BasicLLM(update_planning_prompt),
            planning_evaluation_prompt,
            feedback_prompt,
            lambda result: split_context(result),
        )
        self.update_architect = FeedbackMinion(
            BasicLLM(update_architecture_prompt),
            architecture_evaluation_prompt,
            feedback_prompt,
            lambda result: extract_after_keyword(result, "FINAL ARCHITECTURE:"),
        )

    def create_initial_plan(self, project: Project) -> tuple[str, str, Plan]:
        architecture = extract_after_keyword(
            self.initial_architect.run(plan='No plan yet', **project.prompt_fields()),
            "FINAL ARCHITECTURE:",
        )
        context, plan = split_context(
            self.initial_planner.run(**project.prompt_fields())
        )

        return architecture, context, plan

    def update_plan(
        self, plan: Plan, report: str, project: Project
    ) -> typing.Tuple[Plan, str, str]:
        architecture = extract_after_keyword(
            self.update_architect.run(
                **project.prompt_fields(), report=report, plan=str(plan)
            ),
            "FINAL ARCHITECTURE:",
        )
        project.architecture = architecture
        context, plan = split_context(
            self.update_planner.run(
                **project.prompt_fields(), report=report, plan=str(plan)
            )
        )
        # if "FINISHED" in result:
        #     return Plan([], []), project.state, project.architecture
        return plan, context, project.architecture

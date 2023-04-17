from __future__ import annotations

from dataclasses import dataclass
from project import Project
from minions.qa import QA
from minions.executioner import Executioner
from minions.planner import Planner, Plan


@dataclass
class Clippy:
    project: Project
    qa: QA
    executioner: Executioner
    planner: Planner
    plan: Plan

    @classmethod
    def create(cls, path: str, objective: str) -> Clippy:
        project = Project.create(path, objective)
        qa = QA()
        executioner = Executioner()
        planner = Planner()
        plan = planner.create_initial_plan(project)
        print('Created plan:', str(plan), sep='\n')
        return cls(project, qa, executioner, planner, plan)

    def execute_task(self, task: str) -> str:
        print('Executing task:', task)
        return self.executioner.execute(task, self.project)

    def run_iteration(self):
        result = self.execute_task(self.plan.first_milestone_tasks[0])
        self.plan.completed_tasks.append(self.plan.first_milestone_tasks[0])
        self.plan.first_milestone_tasks = self.plan.first_milestone_tasks[1:]
        completed_tasks, completed_milestones = self.plan.completed_tasks, self.plan.completed_milestones
        if not self.plan.first_milestone_tasks:
            self.plan.completed_milestones.append(self.plan.milestones[0])
            self.plan.milestones = self.plan.milestones[1:]
            completed_tasks = []
            # Later we can run checks here
        self.plan = self.planner.update_plan(self.plan, result, self.project)
        self.plan.completed_tasks, self.plan.completed_milestones = completed_tasks, completed_milestones
        self.project.update()

    def run(self):
        while self.plan.milestones:
            self.run_iteration()
        print('Done!')

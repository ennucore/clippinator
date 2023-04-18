from __future__ import annotations

from dataclasses import dataclass
import pickle
from .project import Project
from .minions.qa import QA
from .minions.executioner import Executioner
from .minions.planner import Planner, Plan


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
        executioner = Executioner(project)
        planner = Planner(project)
        plan, state = planner.create_initial_plan(project)
        project.state = state
        print('Created plan:', str(plan), sep='\n')
        print('Context:', project.state)
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
        self.plan, self.project.state = self.planner.update_plan(self.plan, result, self.project)
        print('New plan:', str(self.plan), sep='\n')
        print('Context:', self.project.state)
        self.plan.completed_tasks, self.plan.completed_milestones = completed_tasks, completed_milestones
        self.project.update()
        self.save_to_file()

    def run(self):
        while self.plan.milestones:
            self.run_iteration()
        print('Done!')

    def save_to_file(self, path: str = 'clippy.pkl'):
        with open(path, 'wb') as f:
            pickle.dump(self, f)

    @classmethod
    def load_from_file(cls, path: str = 'clippy.pkl'):
        with open(path, 'rb') as f:
            return pickle.load(f)

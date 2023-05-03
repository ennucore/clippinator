from __future__ import annotations

from dataclasses import dataclass, field
import pickle
from .project import Project
from .minions.qa import QA
from .minions.executioner import Executioner, get_specialized_executioners, SpecializedExecutioner
from .minions.planner import Planner, Plan
from .minions import extract_agent_name


@dataclass
class Clippy:
    project: Project
    qa: QA
    executioner: Executioner
    planner: Planner
    plan: Plan
    specialized_executioners: dict[str, SpecializedExecutioner] = field(default_factory=dict)
 
    @classmethod
    def create(cls, path: str, objective: str) -> Clippy:
        project = Project.create(path, objective)
        qa = QA()
        executioner = Executioner(project)
        planner = Planner(project)
        specialized_executioners = get_specialized_executioners(project)
        architecture, state, plan = planner.create_initial_plan(project, specialized_executioners)
        project.state = state
        project.architecture = architecture
        print("Created plan:", str(plan), sep="\n")
        print("Context:", project.state)
        return cls(project, qa, executioner, planner, plan, specialized_executioners)

    def get_specialized_agent(self, agent: str) -> SpecializedExecutioner:
        return self.specialized_executioners.get(agent, self.executioner)

    def execute_task(self, task: str, milestone: str = "", agent: str = '') -> str:
        print("Executing task:", task)
        return self.get_specialized_agent(agent).execute(task, self.project, milestone)

    def run_iteration(self):
        task, agent = extract_agent_name(self.plan.first_milestone_tasks[0])
        result = self.execute_task(
            task, self.plan.milestones[0]
        )
        self.plan.completed_tasks.append(self.plan.first_milestone_tasks[0])
        self.plan.first_milestone_tasks = self.plan.first_milestone_tasks[1:]
        completed_tasks, completed_milestones = (
            self.plan.completed_tasks,
            self.plan.completed_milestones,
        )
        if not self.plan.first_milestone_tasks:
            self.plan.completed_milestones.append(self.plan.milestones[0])
            self.plan.milestones = self.plan.milestones[1:]
            completed_tasks = []
            # Later we can run checks here
        self.plan, self.project.state, self.project.architecture = self.planner.update_plan(
            self.plan, result, self.project, self.specialized_executioners
        )
        print("New plan:", str(self.plan), sep="\n")
        print("Context:", self.project.state)
        self.plan.completed_tasks, self.plan.completed_milestones = (
            completed_tasks,
            completed_milestones,
        )
        self.project.update()
        self.save_to_file()

    def run(self):
        while self.plan.milestones:
            self.run_iteration()
        print("Done!")

    def save_to_file(self, path: str = ""):
        path = path or f"clippy_{self.project.name}.pkl"
        with open(path, "wb") as f:
            pickle.dump((self.plan, self.project), f)

    @classmethod
    def load_from_file(cls, path: str = "clippy.pkl"):
        with open(path, "rb") as f:
            plan, project = pickle.load(f)
        qa = QA()
        executioner = Executioner(project)
        planner = Planner(project)
        return cls(project, qa, executioner, planner, plan)

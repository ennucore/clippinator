from dataclasses import dataclass
from project import Project
from minions.qa import QA
from minions.executioner import Executioner
from minions.planner import Planner


@dataclass
class Clippy:
    project: Project
    qa: QA
    executioner: Executioner
    planner: Planner

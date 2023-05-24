from __future__ import annotations

import os
from dataclasses import dataclass, field

from clippy.project.project_summary import get_file_summary


@dataclass
class Project:
    path: str
    objective: str
    state: str = ""
    architecture: str = ""
    summary_cache: str = ""
    memories: list[str] = field(default_factory=list)

    @classmethod
    def create(cls, path: str, objective: str) -> Project:
        path = os.path.realpath(path)
        self = cls(path, objective)
        self.update()
        return self

    @property
    def name(self) -> str:
        return os.path.basename(self.path)

    def get_folder_summary(self, path: str, ident: str = "") -> str:
        """
        Get the summary of a folder in the project, recursively, file-by-file, using self.get_file_summary()
        path:
            dir1:
                file1.py
                    72|class A:
                    80|def create(self, a: str) -> A:
                    100|class B:
                file2.py
            dir2:
                file3.py
        """
        from clippy.tools.utils import skip_file
        from clippy.tools.code_tools import lint_project

        res = ""
        for file in os.listdir(path):
            file_path = os.path.join(path, file)
            if skip_file(file_path):
                continue
            if os.path.isdir(file_path):
                res += f"{ident}{file}:\n"
                res += self.get_folder_summary(file_path, ident + "  ")
            else:
                res += f"{ident}{file}\n"
                res += get_file_summary(file_path, ident + "  ")
        if len(res) > 4000:
            print(f"Warning: long project summary at {path}, truncating to 4000 chars")
            res = res[:4000] + "..."
        res += '\n--\n'
        res += lint_project(path) + '\n---'
        return res

    def get_project_summary(self) -> str:
        self.summary_cache = self.get_folder_summary(self.path)
        return self.summary_cache

    def get_project_prompt(self) -> str:
        res = f"The project: {self.name}.\n"
        res += f"Objective: {self.objective}\n"
        res += f"Current state: {self.state}\n"
        if self.get_project_summary():
            res += f"Files:\n{self.get_project_summary()}\n"
        return res

    def update(self):
        self.get_project_summary()

    def prompt_fields(self) -> dict:
        return {
            "objective": self.objective,
            "state": self.state,
            "architecture": self.architecture,
            "project_name": self.name,
            "project_summary": self.get_project_summary(),
            "memories": '  - ' + "\n  - ".join(self.memories),
        }

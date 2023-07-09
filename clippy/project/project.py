from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass, field

from clippy.project.project_summary import get_file_summary


@dataclass
class Project:
    path: str
    objective: str
    state: str = ""
    architecture: str = ""
    summary_cache: str = ""
    ci_commands: dict[str, str] = field(default_factory=dict)  # keys: 'run', 'lint', 'lint_file', 'test'
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

    def get_folder_summary(self, path: str, ident: str = "", add_linting: bool = True, top_level: bool = False,
                           length_3: int = 4000) -> str:
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
        from clippy.tools.utils import skip_file, trim_extra

        res = ""
        if not os.path.isdir(path):
            return ""
        for file in os.listdir(path):
            file_path = os.path.join(path, file)
            if skip_file(file_path):
                continue
            if os.path.isdir(file_path):
                res += f"{ident}{file}:\n"
                res += self.get_folder_summary(file_path, ident + "  ", False, length_3=length_3)
            else:
                res += f"{ident}{file}\n"
                res += get_file_summary(file_path, ident + "  ",
                                        length_1=length_3 // 10, length_2=round(length_3 / 6.6))
        if len(res) > length_3:
            print(f"Warning: long project summary at {path}, truncating to {length_3} chars")
            res = trim_extra(res, length_3)
        if not res.replace('-', '').strip() and top_level:
            return "(nothing in the project directory)"
        if add_linting:
            res += '\n--\n'
            res += self.lint(path)
            res += '\n-----\n'
        return res

    def lint(self, path: str = ''):
        from clippy.tools.code_tools import lint_project
        from clippy.tools.utils import trim_extra

        path = path or self.path
        if self.ci_commands.get('lint'):
            cmd = self.ci_commands['lint']
            process = subprocess.run(cmd, capture_output=True, text=True)
            return trim_extra(process.stdout.strip(), 4000)
        return lint_project(path)

    def lint_file(self, path: str):
        from clippy.tools.code_tools import lint_file
        from clippy.tools.utils import trim_extra

        if self.ci_commands.get('lintfile'):
            cmd = self.ci_commands['lintfile'] + ' ' + path
            process = subprocess.run(cmd, capture_output=True, text=True)
            return trim_extra(process.stdout.strip(), 1000)
        return lint_file(path)

    def get_project_summary(self) -> str:
        self.summary_cache = self.get_folder_summary(self.path, top_level=True)
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

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
    template: str = "General"
    ci_commands: dict[str, str] = field(default_factory=dict)  # keys: 'run', 'lint', 'lint_file', 'test'
    memories: list[str] = field(default_factory=list)

    @property
    def name(self) -> str:
        return os.path.basename(self.path)

    def get_folder_summary(self, path: str, indent: str = "", add_linting: bool = True, top_level: bool = False,
                           length_3: int = 3000) -> str:
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
        from clippy.tools.utils import skip_file, skip_file_summary, trim_extra

        res = ""
        if not os.path.isdir(path):
            return ""
        for file in os.listdir(path):
            file_path = os.path.join(path, file)
            if skip_file(file_path):
                continue
            if os.path.isdir(file_path):
                res += f"{indent}{file}:\n"
                res += self.get_folder_summary(file_path, indent + "  ", False)
            else:
                res += f"{indent}{file}\n"
                if not skip_file_summary(file_path):
                    res += get_file_summary(file_path, indent + "  ",
                                            length_1=length_3 // 11, length_2=round(length_3 / 7))
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

        path = os.path.join(self.path, path)
        path = path or self.path
        if self.ci_commands.get('lint'):
            cmd = self.ci_commands['lint']
            try:
                process = subprocess.run(['/bin/bash', '-c', cmd], capture_output=True,
                                         text=True, cwd=self.path)
            except Exception as e:
                return f"Linter error: {e}"
            return trim_extra(process.stdout.strip(), 1100)
        return lint_project(path)

    def lint_file(self, path: str):
        from clippy.tools.code_tools import lint_file
        from clippy.tools.utils import trim_extra

        path = os.path.join(self.path, path)
        if self.ci_commands.get('lintfile', '').strip():
            cmd = self.ci_commands['lintfile'] + ' ' + path
            try:
                process = subprocess.run(
                    ['/bin/bash', '-c', cmd], capture_output=True,
                    text=True, cwd=self.path)
            except Exception as e:
                return f"Linter error: {e}"
            return trim_extra(process.stdout.strip(), 1000)
        return lint_file(path)

    def get_project_summary(self) -> str:
        self.summary_cache = self.get_folder_summary(self.path, top_level=True)
        return self.summary_cache

    def prompt_fields(self) -> dict:
        from clippy.tools.architectural import templates

        default_architecture = templates['General']['architecture']

        return {
            "objective": self.objective,
            "state": self.state,
            "architecture": self.architecture,
            "project_name": self.name,
            "project_summary": self.get_project_summary(),
            "memories": '  - ' + "\n  - ".join(self.memories),
            "architecture_example": templates.get(self.template, {}).get('architecture', default_architecture),
        }

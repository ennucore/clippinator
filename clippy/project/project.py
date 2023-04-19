from __future__ import annotations
from dataclasses import dataclass
import os
import subprocess


def get_file_summary(file_path: str, ident: str = "") -> str:
    """
    | 72| class A:
    | 80| def create(self, a: str) -> A:
    |100| class B:
    """
    cmd = ["ctags", "-x", file_path]
    result = subprocess.run(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    out = ""

    if result.returncode != 0:
        raise RuntimeError(f"Error executing ctags: {result.stderr}")

    lines = result.stdout.splitlines()
    for line in lines:
        parts = line.split()
        line_number = parts[2]
        definition = " ".join(parts[4:])
        out += f"{ident}|{line_number}| {definition}\n"
    return out


@dataclass
class Project:
    path: str
    objective: str
    state: str = ""
    summary_cache: str = ""

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
                    | 72| class A:
                    | 80| def create(self, a: str) -> A:
                    |100| class B:
                file2.py
            dir2:
                file3.py
        """
        res = ""
        for file in os.listdir(path):
            file_path = os.path.join(path, file)
            if file in ('.git', '.idea', '__pycache__', 'venv') or '_venv' in file:
                continue
            if os.path.isdir(file_path):
                res += f"{ident}{file}:\n"
                res += self.get_folder_summary(file_path, ident + "  ")
            else:
                res += f"{ident}{file}\n"
                res += get_file_summary(file_path, ident + "  ")
        if len(res) > 600:
            print("Warning: long project summary, truncating to 600 chars")
            res = res[:600] + "..."
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
            "project_name": self.name,
            "project_summary": self.get_project_summary(),
        }

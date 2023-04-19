from .tool import SimpleTool
from dataclasses import dataclass
import os
import subprocess


@dataclass
class FindUsages(SimpleTool):
    pass


@dataclass
class Search(SimpleTool):
    pass


@dataclass
class SearchAndReplace(SimpleTool):
    pass


@dataclass
class Pylint(SimpleTool):
    name = "Pylint"
    description = (
        "runs pylint to check for python errors. By default it runs on the entire project. "
        "You can specify a relative path to run on a specific file or module."
    )

    def __init__(self, wd: str = "."):
        self.workdir = wd

    def run_pylint_on_file(self, target: str) -> list[str]:
        cmd = ["pylint", target, "-E", "--output-format", "text"]
        process = subprocess.run(cmd, capture_output=True, text=True)
        pylint_output = process.stdout.strip().split("\n")
        return pylint_output

    def func(self, args: str) -> str:
        target = args.strip() if args.strip() else self.workdir
        target = os.path.join(self.workdir, target)

        pylint_output = []

        if os.path.isfile(target) and target.endswith(".py"):
            pylint_output = self.run_pylint_on_file(target)
        elif os.path.isdir(target):
            for root, _, files in os.walk(target):
                for file in files:
                    if file.endswith(".py"):
                        file_path = os.path.join(root, file)
                        pylint_output.extend(self.run_pylint_on_file(file_path))
        else:
            return f"Target not found: {target}"

        # Format the output for better readability
        formatted_output = "\n".join(pylint_output)

        return formatted_output

from dataclasses import dataclass
from .tool import Toolkit, Tool


@dataclass
class WriteFile(Tool):
    """
    A tool that can be used to write files.
    """
    name = "WriteFile"

    def description(self):
        return "A tool that can be used to write files."

    def run(self, args: str) -> str:
        pass


@dataclass
class ReadFile(Tool):
    """
    A tool that can be used to read files.
    """
    name = "ReadFile"

    def description(self):
        return "A tool that can be used to read files."

    def run(self, args: str) -> str:
        pass


@dataclass
class PatchFile(Tool):
    """
    A tool that can be used to patch files.
    """
    name = "PatchFile"

    def description(self):
        return "A tool that can be used to patch files."

    def run(self, args: str) -> str:
        pass


@dataclass
class FileTools(Toolkit):
    """
    A tool that can be used to read and write files.
    """
    def __init__(self):
        super().__init__(
            name="file tools",
            tools=[
                WriteFile(),
                ReadFile(),
                PatchFile()
            ]
        )

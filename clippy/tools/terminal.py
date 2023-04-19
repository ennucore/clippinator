import os
import pty
import subprocess
from typing import List, Union
import fcntl
import select
import re
from abc import ABC
from dataclasses import dataclass

from langchain.agents import Tool


class RunBash:
    """Executes bash commands and returns the output."""

    def __init__(
            self,
            strip_newlines: bool = False,
            return_err_output: bool = False,
            workdir: str = ".",
    ):
        """Initialize with stripping newlines."""
        self.strip_newlines = strip_newlines
        self.return_err_output = return_err_output
        self.workdir = workdir

    def run(self, commands: Union[str, List[str]]) -> str:
        """Run commands and return final output."""
        if isinstance(commands, str):
            commands = [commands]
        commands = ";".join(commands)

        try:
            completed_process = subprocess.run(
                commands,
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=self.workdir,
                timeout=40,
            )
        except subprocess.TimeoutExpired as error:
            return "Command timed out, possibly due to asking for input."

        stdout_output = completed_process.stdout.decode()
        stderr_output = completed_process.stderr.decode()

        if self.strip_newlines:
            stdout_output = stdout_output.strip()
            stderr_output = stderr_output.strip()

        combined_output = stdout_output + "\n" + stderr_output
        return combined_output


class BashSession(Tool):
    name: str = "Bash Session"

    def __init__(self, timeout: float | None = None):
        self.timeout = timeout
        self.master_fd, self.slave_fd = pty.openpty()
        self.bash_process = subprocess.Popen(
            ["bash"],
            stdin=self.slave_fd,
            stdout=self.slave_fd,
            stderr=subprocess.STDOUT,
            text=True,
        )

        # Set master_fd to be non-blocking
        fl = fcntl.fcntl(self.master_fd, fcntl.F_GETFL)
        fcntl.fcntl(self.master_fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)

    def input(self, command, timeout: float | None = None):
        os.write(self.master_fd, (command + "\n").encode())
        output = self._read_output(timeout or self.timeout or 0.5)

        # Remove the echoed command and filter out control characters
        output = re.sub(re.escape(command) + r"\r\n", "", output)
        output = re.sub(r"\x1b\[[0-9;]*[a-zA-Z]", "", output)

        return output

    def run(self, args: str) -> str:
        return self.input(args)

    def _read_output(self, timeout=0.1):
        output = []
        while True:
            rlist, _, _ = select.select([self.master_fd], [], [], timeout)
            if not rlist:
                break
            try:
                data = os.read(self.master_fd, 1024)
                if not data:
                    break
                output.append(data.decode())
            except OSError:
                break

        return "".join(output)

    def __del__(self):
        os.close(self.master_fd)
        os.close(self.slave_fd)
        self.bash_process.terminate()

    @property
    def description(self) -> str:
        return (
            f"a bash session that can be used to run commands in a single session, even in the background. "
            f"You can input something into bash's stdin, and then it will run for {self.timeout or 0.5} seconds "
            f"and return the output. If you want to simply run a standalone command in the project directory "
            f"and get the output, use the `Bash` tool instead."
        )


@dataclass
class Terminal(Tool, ABC):
    """
    A tool that creates terminal sessions that can be used to run commands, even in the background.
    """

    # todo

import os
import pty
import subprocess
from typing import List, Union
import time
import fcntl
import select
import re
from abc import ABC
from dataclasses import dataclass

from langchain.agents import Tool

from .tool import SimpleTool


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
                timeout=120,
            )
        except subprocess.TimeoutExpired as error:
            return "Command timed out, possibly due to asking for input."

        stdout_output = completed_process.stdout.decode()
        stderr_output = completed_process.stderr.decode()

        if self.strip_newlines:
            stdout_output = stdout_output.strip()
            stderr_output = stderr_output.strip()

        combined_output = stdout_output + "\n" + stderr_output
        return combined_output if combined_output.strip() else "(empty)"


class RunPython:
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

    def run(self, commands: str) -> str:
        """Run commands and return final output."""

        try:
            completed_process = subprocess.run(
                ['python', '-c', commands],
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
        return combined_output if combined_output.strip() else "(empty)"


# Yes, the current processes are stored in a global variable
bash_processes = []


@dataclass
class BashBackgroundSessions(SimpleTool):
    name = "BashBackground"
    description = "A tool that can be used to run bash commands in the background."

    def __init__(self, wd: str):
        self.workdir = wd
        self.description = (
            "A tool that can be used to start bash processes in the background. "
            "By default, it starts a process using input as a command. There are special commands:\n"
            "    - `/killall` kills all background processes\n"
            "    - `/kill <pid>` kills the process with the given pid\n"
            "    - `/logs <pid>` gets the output of a process\n"
        )
        self.description += 'Current processes:\n'
        for process in bash_processes:
            self.description += f'    - pid: {process["pr"].pid}| `{process["args"][:50]}`\n'

    def func(self, args: str) -> str:
        global bash_processes
        args = args.strip().strip('`').strip("'").strip('"').strip()
        if args == "/killall":
            for process in bash_processes:
                process["pr"].kill()
            bash_processes = []
            return "Killed all processes.\n"
        elif args.startswith("/kill"):
            pid = int(args.split()[1])
            for process in bash_processes:
                if process["pr"].pid == pid:
                    process["pr"].terminate()
                    os.system(f"kill -9 {pid}")
                    os.system(f"kill -9 {pid + 1}")
                    bash_processes.remove(process)
                    return f"Killed process with pid {pid}.\n"
            return f"Could not find process with pid {pid}.\n"
        elif args.startswith("/logs"):
            if ' ' not in args:
                return "Please specify a pid.\n"
            pid = int(args.split()[1])
            for process in bash_processes:
                if process["pr"].pid == pid:
                    fd = process["pr"].stdout.fileno()
                    fl = fcntl.fcntl(fd, fcntl.F_GETFL)
                    fcntl.fcntl(fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)
                    ready_to_read, _, _ = select.select([process["pr"].stdout], [], [], 0)
                    output = '\n'.join([part.read() for part in ready_to_read])
                    return '```\n' + output + '\n```\n'
            return f"Could not find process with pid {pid}.\n"
        else:
            process = subprocess.Popen(
                ["bash"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                cwd=self.workdir,
            )
            fd = process.stdout.fileno()
            fl = fcntl.fcntl(fd, fcntl.F_GETFL)
            fcntl.fcntl(fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)
            process.stdin.write(args + '\n')
            process.stdin.close()
            bash_processes.append({"pr": process, "args": args})
            time.sleep(3)
            # Read current output
            ready_to_read, _, _ = select.select([process.stdout], [], [], 0)
            output = '\n'.join([part.read() for part in ready_to_read])
            return f"Started process with pid {process.pid}.\n```\n{output}\n```\n"


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

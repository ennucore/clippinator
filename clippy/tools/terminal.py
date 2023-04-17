import os
import pty
import subprocess
import fcntl
import select
import re
from abc import ABC
from dataclasses import dataclass

from .tool import Tool


class BashSession:
    def __init__(self, timeout: float | None = None):
        self.timeout = timeout
        self.master_fd, self.slave_fd = pty.openpty()
        self.bash_process = subprocess.Popen(['bash'], stdin=self.slave_fd, stdout=self.slave_fd,
                                             stderr=subprocess.STDOUT, text=True)

        # Set master_fd to be non-blocking
        fl = fcntl.fcntl(self.master_fd, fcntl.F_GETFL)
        fcntl.fcntl(self.master_fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)

    def input(self, command, timeout: float | None = None):
        os.write(self.master_fd, (command + "\n").encode())
        output = self._read_output(timeout or self.timeout or 0.1)

        # Remove the echoed command and filter out control characters
        output = re.sub(re.escape(command) + r'\r\n', '', output)
        output = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', output)

        return output

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

        return ''.join(output)

    def __del__(self):
        os.close(self.master_fd)
        os.close(self.slave_fd)
        self.bash_process.terminate()


@dataclass
class Terminal(Tool, ABC):
    """
    A tool that creates terminal sessions that can be used to run commands, even in the background.
    """
    # todo

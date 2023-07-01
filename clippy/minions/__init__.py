from __future__ import annotations


def extract_agent_name(task: str) -> (str, str):
    """
    Extract the agent name from the task
    """
    if "@" not in task:
        return task, None
    agent = task.strip().split("@")[-1]
    task = '@'.join(task.strip().split("@")[:-1])
    return task.strip().strip('(').strip(), agent.strip().strip(')')

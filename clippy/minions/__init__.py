from __future__ import annotations


def extract_agent_name(task: str) -> (str, str):
    """
    Extract the agent name from the task
    """
    if "@" not in task:
        return task, None
    task, agent = task.split("@", 1)
    return task.strip().strip('(').strip(), agent.strip().strip(')')

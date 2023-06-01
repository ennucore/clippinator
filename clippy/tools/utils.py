def skip_file(filename: str) -> bool:
    filename = filename.strip('/').split('/')[-1]
    if filename.startswith('.'):
        return True
    return filename in ('.git', '.idea', '__pycache__', 'venv', 'node_modules', 'data') or 'venv' in filename


def trim_extra(content: str, max_length: int = 1500) -> str:
    if len(content) > max_length:
        content = content[:max_length] + f"\n...[skipped {len(content) - max_length - 100} chars]\n" + content[-100:]
    return content

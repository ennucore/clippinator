def skip_file(filename: str) -> bool:
    filename = filename.strip('/').split('/')[-1]
    if filename.startswith('.'):
        return True
    return filename in ('.git', '.idea', '__pycache__', 'venv', 'node_modules') or 'venv' in filename

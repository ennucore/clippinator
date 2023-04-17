from dataclasses import dataclass
import os


@dataclass
class Project:
    path: str
    objective: str
    state: str = ''

    def get_file_summary(self, file_path: str, ident: str = '') -> str:
        pass

    @property
    def name(self) -> str:
        return os.path.basename(self.path)

    def get_folder_summary(self, path: str, ident: str = '') -> str:
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
        res = ''
        for file in os.listdir(path):
            file_path = os.path.join(path, file)
            if os.path.isdir(file_path):
                res += f'{ident}{file}:\n'
                res += self.get_folder_summary(file_path, ident + '  ')
            else:
                res += f'{ident}{file}\n'
                res += self.get_file_summary(file_path, ident + '  ')
        return res

    def get_project_summary(self) -> str:
        return self.get_folder_summary(self.path)

    def get_project_prompt(self) -> str:
        res = f'The project: {self.name}.\n'
        res += f'Objective: {self.objective}\n'
        res += f'Current state: {self.state}\n'
        if self.get_project_summary():
            res += f'Files:\n{self.get_project_summary()}\n'
        return res

export class Environment {
    fileSystem: FileSystem;
    browser: Browser;
    terminal: Terminal;
    user_interface: UserInterface;

    constructor(fileSystem: FileSystem, browser: Browser, terminal: Terminal, user_interface: UserInterface) {
        this.fileSystem = fileSystem;
        this.browser = browser;
        this.terminal = terminal;
        this.user_interface = user_interface;
    }

    async getFileSystem(): Promise<FileSystemTree> {
        return this.fileSystem.getFileSystem();
    }
    async getBrowserState(): Promise<BrowserTab[]> {
        return this.browser.getBrowserState();
    }
    async getTerminalState(): Promise<TerminalTab[]> {
        return this.terminal.getTerminalState();
    }
    async writeFile(path: string, content: string): Promise<void> {
        this.fileSystem.writeFile(path, content);
    }

    async deleteFile(path: string): Promise<void> {
        this.fileSystem.deleteFile(path);
    }
    async runCommand(command: string, tabIndex?: number): Promise<string> {
        return this.terminal.runCommand(command, tabIndex);
    }
    async openUrl(url: string, tabIndex?: number): Promise<string> {
        return this.browser.openUrl(url, tabIndex);
    }
    async showMessage(message: string): Promise<void> {
        this.user_interface.showMessage(message);
    }
    async askPrompt(prompt: string): Promise<string> {
        return this.user_interface.askPrompt(prompt);
    }
    async getNewMessages(): Promise<string[]> {
        return this.user_interface.getNewMessages();
    }
}

export interface UserInterface {
    showMessage(message: string): Promise<void>;
    askPrompt(prompt: string): Promise<string>;
    getNewMessages(): Promise<string[]>;
}

export class FileSystemTree {
    path: string;
    isDirectory: boolean;
    content: string[] | null;
    children?: FileSystemTree[];

    constructor(path: string, isDirectory: boolean, content: string[] | null, children?: FileSystemTree[]) {
        this.path = path;
        this.isDirectory = isDirectory;
        this.content = content;
        this.children = children;
    }

    getByPath(path: string): FileSystemTree | null {
        if (this.path === path) return this;
        if (this.children) {
            for (let child of this.children) {
                const result = child.getByPath(path);
                if (result) return result;
            }
        }
        return null;
    }
}

export interface FileSystem {
    getFileSystem(): Promise<FileSystemTree>;
    writeFile(path: string, content: string): Promise<void>;
    deleteFile(path: string): Promise<void>;
}

interface BrowserTab {
    url: string;
    html: string;
}

interface Browser {
    getBrowserState(): Promise<BrowserTab[]>;
    openUrl(url: string, tabIndex?: number): Promise<string>;
}

interface TerminalTab {
    history: string[];
}

interface Terminal {
    getTerminalState(): Promise<TerminalTab[]>;
    runCommand(command: string, tabIndex?: number): Promise<string>;   // returns the tab index
}

export class DummyTerminal implements Terminal {
    async getTerminalState(): Promise<TerminalTab[]> {
        return [];
    }
    async runCommand(command: string, tabIndex?: number): Promise<string> {
        return "";
    }
}

export class SimpleTerminal implements Terminal {
    rootPath: string;
    constructor(rootPath: string) {
        this.rootPath = rootPath;
    }

    async getTerminalState(): Promise<TerminalTab[]> {
        return [];
    }
    async runCommand(command: string, tabIndex?: number): Promise<string> {
        const commandOutput = (require('child_process').execSync(command, { cwd: this.rootPath })).toString();
        return commandOutput;
    }
}

export class DummyBrowser implements Browser {
    async getBrowserState(): Promise<BrowserTab[]> {
        return [];
    }
    async openUrl(url: string, tabIndex?: number): Promise<string> {
        return "";
    }
}

// import * as inquirer from 'inquirer';

export class CLIUserInterface implements UserInterface {
    async showMessage(message: string): Promise<void> {
        console.log(message);
    }
    async askPrompt(prompt: string): Promise<string> {
        // ask for input from the user using inquirer
        const inquirer = await import('inquirer');
        const response = await inquirer.default.prompt([
            {
                type: 'input',
                name: 'response',
                message: prompt
            }
        ]);
        return response.response;
    }
    async getNewMessages(): Promise<string[]> {
        return [];
    }
}


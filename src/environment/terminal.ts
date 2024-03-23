

import { Terminal, TerminalTab } from './environment';
import { spawn, IPty } from 'node-pty';
import { trimString } from '../utils';

class TerminalTabPty implements TerminalTab {
    history: string[];
    pty: IPty;

    constructor(history: string[], pty: IPty) {
        this.history = history;
        this.pty = pty;
    }
}

export class SimpleTerminal implements Terminal {
    private rootPath: string;
    private tabs: TerminalTabPty[];

    constructor(rootPath: string) {
        this.rootPath = rootPath;
        this.tabs = [{ history: [], pty: this.createPtyProcess() }];
    }

    async getTerminalState(): Promise<TerminalTab[]> {
        return this.tabs;
    }

    async runCommand(command: string, tabIndex?: number | "new" | "no", timeout: number = 5000): Promise<string> {
        if (tabIndex === undefined || tabIndex === "no") {
            try {
                const commandOutput = (require('child_process').execSync(command, { cwd: this.rootPath })).toString();
                return commandOutput;
            } catch (e: any) {
                return e.stdout.toString() + e.stderr.toString();
            }
            
        }
        // Determine the tab index
        let selectedTabIndex: number;
        if (tabIndex === "new") {
            // Create a new tab
            this.tabs.push({ history: [], pty: this.createPtyProcess() });
            selectedTabIndex = this.tabs.length - 1;
        } else if (tabIndex !== undefined && tabIndex >= 0 && tabIndex < this.tabs.length) {
            // Use the specified tab index
            selectedTabIndex = tabIndex;
        } else {
            // Use the last tab by default
            selectedTabIndex = this.tabs.length - 1;
        }

        // Get the selected tab
        const selectedTab = this.tabs[selectedTabIndex];

        // Append the command to the tab's history
        selectedTab.history.push(`$ ${command}`);

        // Create a new entry in the tab's history for the command output
        const outputIndex = selectedTab.history.length;
        selectedTab.history.push('');

        // Write the command to the pty process
        selectedTab.pty.write(`${command}\r`);

        // Return a promise that resolves after the specified timeout
        return new Promise<string>((resolve, reject) => {
            let output = '';

            // Set a timeout to resolve the promise after the specified duration
            const timeoutId = setTimeout(() => {
                resolve(output);
            }, timeout);

            // Handle data events from the pty process
            selectedTab.pty.onData((data: string) => {
                output += data;
                // Update the corresponding entry in the tab's history
                selectedTab.history[outputIndex] += data;
            });

            // Handle exit event from the pty process
            selectedTab.pty.onExit((res) => {
                const exitCode = res.exitCode;
                clearTimeout(timeoutId);
                if (exitCode !== 0) {
                    let err_msg = `\nCommand exited with code ${exitCode}`;
                    selectedTab.history[outputIndex] += err_msg;
                    output += err_msg;
                    selectedTab.history[outputIndex] = trimString(selectedTab.history[outputIndex], 10000);
                    resolve(trimString(output, 30000));
                } else {
                    resolve(output);
                }
            });
        });
    }

    private createPtyProcess(): IPty {
        // Create a new pty process
        return spawn(process.env.SHELL || 'bash', [], {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            cwd: this.rootPath,
            env: process.env,
        });
    }
}

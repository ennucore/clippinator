

import { Terminal, TerminalTab } from './environment';
import { spawn, IPty } from 'node-pty';
import { removePrefix, removeSuffix, trimString } from '../utils';

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

    async runCommand(command: string, tabIndex?: number | "new" | "no", timeout: number = 15000, isHardTimeout: boolean = false): Promise<string> {
        if (tabIndex === undefined || tabIndex === "no") {
            try {
                const commandOutput = (require('child_process').execSync(command, { cwd: this.rootPath, env: process.env })).toString();
                return commandOutput;
            } catch (e: any) {
                return (e.stdout || "").toString() + (e.stderr || "").toString();
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
        selectedTab.pty.clear();

        // Write the command to the pty process
        selectedTab.pty.write(`${command}\r`);

        // Return a promise that resolves after the specified timeout
        return new Promise<string>((resolve, reject) => {
            let output = '';
            let finished = false;

            // Set a timeout to resolve the promise after the specified duration
            const timeoutId = setTimeout(() => {
                if (isHardTimeout) {
                    selectedTab.pty.kill();
                }
                output += `\nCommand timed out after ${timeout}ms`;
                resolve(output);
            }, timeout);

            // Handle data events from the pty process
            selectedTab.pty.onData((data: string) => {
                if (finished) {
                    return;
                }
                output += data;
                output = output.split(command + '\r\n')[output.split(command + '\r\n').length - 1];
                // Update the corresponding entry in the tab's history
                selectedTab.history[outputIndex] = output;
                if (output.includes('<COMMAND-DONE/>')) {
                    // console.log(JSON.stringify(output))
                    finished = true;
                    output = output.split('PreExec')[output.split('PreExec').length - 1].split('<COMMAND-DONE/>')[0].split('\x1b')[0].replace(/[\x00-\x07]/g, '').replace(/$[^\n]+\r/, '');
                    clearTimeout(timeoutId);
                    selectedTab.history[outputIndex] = trimString(selectedTab.history[outputIndex], 10000);
                    resolve(trimString(output, 30000));
                }
            });

            // Handle exit event from the pty process
            selectedTab.pty.onExit((res) => {
                if (finished) {
                    return;
                }
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
        return spawn('bash', [], {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            cwd: this.rootPath,
            env: { ...process.env, PROMPT_COMMAND: 'echo "<COMMAND-DONE/>"', PS1: '<COMMAND-START>' },
        });
    }
}

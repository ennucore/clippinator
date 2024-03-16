import * as fs from 'fs';
import * as path from 'path';
import { FileSystemTree, FileSystem } from './environment';

function constructFileSystem(startPath: string): FileSystemTree {
    const stats = fs.statSync(startPath);

    if (stats.isDirectory()) {
        const children = fs.readdirSync(startPath).map(childPath => {
            return constructFileSystem(path.join(startPath, childPath));
        }).filter(child => child !== null); // Filter out null values representing skipped files
        return new FileSystemTree(startPath, true, null, children);
    } else {
        // Skip files larger than 1MB
        if (stats.size > 1024 * 1024) return new FileSystemTree(startPath, false, null);

        // Check for binary content by reading a small part of the file
        const buffer = Buffer.alloc(512);
        const fd = fs.openSync(startPath, 'r');
        fs.readSync(fd, buffer, 0, 512, 0);
        fs.closeSync(fd);

        if (buffer.includes(0)) {
            // File is likely binary, so skip it
            return new FileSystemTree(startPath, false, null);
        }

        const content = fs.readFileSync(startPath, 'utf-8');
        const lines = content.split(/\r?\n/); // Split content into lines
        return new FileSystemTree(startPath, false, lines);
    }
}

export class DefaultFileSystem implements FileSystem {
    root: FileSystemTree;

    constructor(rootPath: string) {
        this.root = constructFileSystem(rootPath);
    }

    async getFileSystem(): Promise<FileSystemTree> {
        return this.root;
    }

    async writeFile(path: string, content: string): Promise<void> {
        fs.writeFileSync(path, content);
    }

    async deleteFile(path: string): Promise<void> {
        fs.unlinkSync(path);
    }
}

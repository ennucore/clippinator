import * as fs from 'fs';
import * as path from 'path';
import { FileSystemTree, FileSystem } from './environment';
import { skip_ext, skip_paths } from '../utils';

function constructFileSystem(startPath: string, removePrefix: string = ""): FileSystemTree {
    const stats = fs.statSync(startPath);

    if (stats.isDirectory()) {
        const children = fs.readdirSync(startPath).map(childPath => {
            // handle skip_ext, skip_paths
            if (skip_paths.includes(childPath.split('/').pop() || '')) return new FileSystemTree(childPath, true, null);
            if (skip_ext.includes(childPath.split('.').pop() || '')) return new FileSystemTree(childPath, false, null);
            return constructFileSystem(path.join(startPath, childPath), removePrefix);
        }).filter(child => child !== null); // Filter out null values representing skipped files
        if (removePrefix) {
            return new FileSystemTree(startPath.replace(removePrefix, ''), true, null, children);
        }
        return new FileSystemTree(startPath, true, null, children);
    } else {
        // Skip files larger than 1MB
        if (stats.size > 1024 * 1024) return new FileSystemTree(startPath.replace(removePrefix, ''), false, null);

        // Check for binary content by reading a small part of the file
        const buffer = Buffer.alloc(512);
        const fd = fs.openSync(startPath, 'r');
        fs.readSync(fd, buffer, 0, 512, 0);
        fs.closeSync(fd);

        if (buffer.includes(0)) {
            // File is likely binary, so skip it
            return new FileSystemTree(startPath.replace(removePrefix, ''), false, null);
        }

        const content = fs.readFileSync(startPath, 'utf-8');
        const lines = content.split(/\r?\n/); // Split content into lines
        return new FileSystemTree(startPath.replace(removePrefix, ''), false, lines);
    }
}

export class DefaultFileSystem implements FileSystem {
    root: FileSystemTree;
    rootPath: string;

    constructor(rootPath: string) {
        // ensure rootPath ends with a slash
        if (!rootPath.endsWith('/')) {
            rootPath = rootPath + '/';
        }
        this.root = constructFileSystem(rootPath, rootPath);
        this.rootPath = rootPath;
    }

    async getFileSystem(): Promise<FileSystemTree> {
        this.root = constructFileSystem(this.rootPath, this.rootPath);
        return this.root;
    }

    async writeFile(path: string, content: string): Promise<void> {
        console.log('writing to', this.rootPath + path);
        fs.writeFileSync(this.rootPath + path, content);
    }

    async deleteFile(path: string): Promise<void> {
        fs.unlinkSync(this.rootPath + path);
    }
}

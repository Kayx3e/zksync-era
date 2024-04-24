import path from 'path';
import { exec } from 'child_process';
import {
    needsRecompilation,
    setCompilationTime,
    isFolderEmpty,
    CONTRACTS_DIR,
    OUTPUT_DIR,
    TIMESTAMP_FILE
} from './utils';

async function main() {
    const timestampFilePath = path.join(process.cwd(), TIMESTAMP_FILE); // File stores the timestamp of last compilation
    const folderToCheck = path.join(process.cwd(), CONTRACTS_DIR); // Directory to check if files & imports were changed after last compilation

    if ((await isFolderEmpty(OUTPUT_DIR)) || needsRecompilation(folderToCheck, timestampFilePath)) {
        console.log('Compilation needed.');
        exec(`hardhat compile`, (error) => {
            if (error) {
                throw error;
            } else {
                console.log('Compilation successful.');
            }
        });
        setCompilationTime(timestampFilePath);
    } else {
        console.log('Compilation not needed.');
        return;
    }
}

main();

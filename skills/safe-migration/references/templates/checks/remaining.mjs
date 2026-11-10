import { execFileSync } from 'node:child_process';

const OLD_THING = 'TODO(a git grep pattern that matches every use of the old thing)';
const WHERE = ['TODO(the folders to search)'];

function filesStillUsingIt() {
  try {
    return execFileSync('git', ['grep', '-I', '-l', '-e', OLD_THING, '--', ...WHERE], {
      encoding: 'utf8'
    })
      .split('\n')
      .filter(Boolean).length;
  } catch (error) {
    if (error.status === 1) return 0;
    throw error;
  }
}

process.stdout.write(`${filesStillUsingIt()} file(s) still use the old thing\n`);

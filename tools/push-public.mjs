// Push the current HEAD tree to the public repo as ONE new commit on top of origin/main.
// Local history (which once contained third-party reference images) is never pushed.
//   node tools/push-public.mjs "message"
import { execSync } from 'node:child_process';
const sh = (c) => execSync(c, { encoding: 'utf8' }).trim();
const msg = process.argv[2] || `Update: ${sh('git log -1 --format=%s')}`;
if (sh('git ls-tree -r --name-only HEAD').split('\n').some((f) => f.startsWith('ref/'))) throw new Error('ref/ is tracked — refusing to publish third-party images');
sh('git fetch -q origin main');
const parent = sh('git rev-parse origin/main');
if (sh(`git rev-parse ${parent}^{tree}`) === sh('git rev-parse HEAD^{tree}')) { console.log('nothing new to push'); process.exit(0); }
const trailer = '\n\nCo-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01UZKmJ5SUz5eyijfriKn4fN';
const commit = execSync(`git commit-tree HEAD^{tree} -p ${parent} -F -`, { input: msg + trailer, encoding: 'utf8' }).trim();
sh(`git push -q origin ${commit}:refs/heads/main`);
console.log(`pushed ${commit.slice(0, 7)} → origin/main`);

import cron from 'node-cron';
import { exec } from 'child_process';

function run(cmd: string) {
  console.log('Running job:', cmd, new Date().toISOString());
  exec(cmd, (err, stdout, stderr) => {
    if (err) console.error('Error', err);
    if (stdout) console.log(stdout.trim());
    if (stderr) console.error(stderr.trim());
  });
}

cron.schedule('0 * * * *', () => run('npm run job:prices'));
cron.schedule('*/15 * * * *', () => run('npm run job:portfolio'));
cron.schedule('*/30 * * * *', () => run('npm run job:leaderboard'));
cron.schedule('*/5 * * * *', () => run('npm run job:csv'));

console.log('Cron runner started');

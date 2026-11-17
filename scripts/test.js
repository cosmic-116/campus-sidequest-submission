import { spawnSync } from 'node:child_process';
if (process.argv.slice(2).join(' ') !== '--reset campus_sidequest_test') {
  console.error('Tests reset ONLY campus_sidequest_test. Opt in with: npm test -- --reset campus_sidequest_test');
  process.exit(1);
}
const result=spawnSync(process.execPath,['--test','--test-concurrency=1','tests/database.test.js','tests/application.test.js'],{
  env:{...process.env,CSQ_TEST_RESET:'campus_sidequest_test'},stdio:'inherit',windowsHide:true
});
process.exit(result.status ?? 1);

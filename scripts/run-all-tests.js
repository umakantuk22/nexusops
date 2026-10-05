import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import path from 'node:path';
import fs from 'node:fs';

const TEST_MANIFEST = [
  'tests/unit/crypto.test.js',
  'tests/unit/authorization.test.js',
  'tests/integration/identity_and_org.test.js',
  'tests/integration/crm_domain.test.js',
  'tests/security/tenant_isolation.test.js',
];

const existingFiles = TEST_MANIFEST.filter((f) => fs.existsSync(f));

run({ files: existingFiles })
  .compose(spec)
  .pipe(process.stdout);

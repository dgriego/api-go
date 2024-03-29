/* global beforeAll, expect, it, jest */
const path = require('path');
const fs = require('fs-extra');
// eslint-disable-next-line import/no-extraneous-dependencies
const execa = require('execa');
const assert = require('assert');
const { createZip } = require('../dist/lambda');
const {
  glob, download, detectBuilders, detectRoutes,
} = require('../');
const {
  getSupportedNodeVersion,
  defaultSelection,
} = require('../dist/fs/node-version');
const {
  packAndDeploy,
  testDeployment,
} = require('../../../test/lib/deployment/test-deployment');

jest.setTimeout(4 * 60 * 1000);

const builderUrl = '@canary';
let buildUtilsUrl;

beforeAll(async () => {
  const buildUtilsPath = path.resolve(__dirname, '..');
  buildUtilsUrl = await packAndDeploy(buildUtilsPath);
  console.log('buildUtilsUrl', buildUtilsUrl);
});

// unit tests

it('should re-create symlinks properly', async () => {
  const files = await glob('**', path.join(__dirname, 'symlinks'));
  assert.equal(Object.keys(files).length, 2);

  const outDir = path.join(__dirname, 'symlinks-out');
  await fs.remove(outDir);

  const files2 = await download(files, outDir);
  assert.equal(Object.keys(files2).length, 2);

  const [linkStat, aStat] = await Promise.all([
    fs.lstat(path.join(outDir, 'link.txt')),
    fs.lstat(path.join(outDir, 'a.txt')),
  ]);
  assert(linkStat.isSymbolicLink());
  assert(aStat.isFile());
});

it('should create zip files with symlinks properly', async () => {
  const files = await glob('**', path.join(__dirname, 'symlinks'));
  assert.equal(Object.keys(files).length, 2);

  const outFile = path.join(__dirname, 'symlinks.zip');
  await fs.remove(outFile);

  const outDir = path.join(__dirname, 'symlinks-out');
  await fs.remove(outDir);
  await fs.mkdirp(outDir);

  await fs.writeFile(outFile, await createZip(files));
  await execa('unzip', [outFile], { cwd: outDir });

  const [linkStat, aStat] = await Promise.all([
    fs.lstat(path.join(outDir, 'link.txt')),
    fs.lstat(path.join(outDir, 'a.txt')),
  ]);
  assert(linkStat.isSymbolicLink());
  assert(aStat.isFile());
});

it('should only match supported node versions', () => {
  expect(getSupportedNodeVersion('10.x')).resolves.toHaveProperty('major', 10);
  expect(getSupportedNodeVersion('8.10.x')).resolves.toHaveProperty('major', 8);
  expect(getSupportedNodeVersion('8.11.x')).rejects.toThrow();
  expect(getSupportedNodeVersion('6.x')).rejects.toThrow();
  expect(getSupportedNodeVersion('999.x')).rejects.toThrow();
  expect(getSupportedNodeVersion('foo')).rejects.toThrow();
  expect(getSupportedNodeVersion('')).resolves.toBe(defaultSelection);
  expect(getSupportedNodeVersion(null)).resolves.toBe(defaultSelection);
  expect(getSupportedNodeVersion(undefined)).resolves.toBe(defaultSelection);
});

it('should match all semver ranges', () => {
  // See https://docs.npmjs.com/files/package.json#engines
  expect(getSupportedNodeVersion('10.0.0')).resolves.toHaveProperty(
    'major',
    10,
  );
  expect(getSupportedNodeVersion('10.x')).resolves.toHaveProperty('major', 10);
  expect(getSupportedNodeVersion('>=10')).resolves.toHaveProperty('major', 10);
  expect(getSupportedNodeVersion('>=10.3.0')).resolves.toHaveProperty(
    'major',
    10,
  );
  expect(getSupportedNodeVersion('8.5.0 - 10.5.0')).resolves.toHaveProperty(
    'major',
    10,
  );
  expect(getSupportedNodeVersion('>=9.0.0')).resolves.toHaveProperty(
    'major',
    10,
  );
  expect(getSupportedNodeVersion('>=9.5.0 <=10.5.0')).resolves.toHaveProperty(
    'major',
    10,
  );
  expect(getSupportedNodeVersion('~10.5.0')).resolves.toHaveProperty(
    'major',
    10,
  );
  expect(getSupportedNodeVersion('^10.5.0')).resolves.toHaveProperty(
    'major',
    10,
  );
});

it('should support require by path for legacy builders', () => {
  const index = require('@now/build-utils');

  const download2 = require('@now/build-utils/fs/download.js');
  const getWriteableDirectory2 = require('@now/build-utils/fs/get-writable-directory.js');
  const glob2 = require('@now/build-utils/fs/glob.js');
  const rename2 = require('@now/build-utils/fs/rename.js');
  const {
    runNpmInstall: runNpmInstall2,
  } = require('@now/build-utils/fs/run-user-scripts.js');
  const streamToBuffer2 = require('@now/build-utils/fs/stream-to-buffer.js');

  const FileBlob2 = require('@now/build-utils/file-blob.js');
  const FileFsRef2 = require('@now/build-utils/file-fs-ref.js');
  const FileRef2 = require('@now/build-utils/file-ref.js');
  const { Lambda: Lambda2 } = require('@now/build-utils/lambda.js');

  expect(download2).toBe(index.download);
  expect(getWriteableDirectory2).toBe(index.getWriteableDirectory);
  expect(glob2).toBe(index.glob);
  expect(rename2).toBe(index.rename);
  expect(runNpmInstall2).toBe(index.runNpmInstall);
  expect(streamToBuffer2).toBe(index.streamToBuffer);

  expect(FileBlob2).toBe(index.FileBlob);
  expect(FileFsRef2).toBe(index.FileFsRef);
  expect(FileRef2).toBe(index.FileRef);
  expect(Lambda2).toBe(index.Lambda);
});

// own fixtures

const fixturesPath = path.resolve(__dirname, 'fixtures');

// eslint-disable-next-line no-restricted-syntax
for (const fixture of fs.readdirSync(fixturesPath)) {
  if (fixture.includes('zero-config')) {
    // Those have separate tests
    continue; // eslint-disable-line no-continue
  }

  // eslint-disable-next-line no-loop-func
  it(`should build ${fixture}`, async () => {
    await expect(
      testDeployment(
        { builderUrl, buildUtilsUrl },
        path.join(fixturesPath, fixture),
      ),
    ).resolves.toBeDefined();
  });
}

// few foreign tests

const buildersToTestWith = ['now-next', 'now-node', 'now-static-build'];

// eslint-disable-next-line no-restricted-syntax
for (const builder of buildersToTestWith) {
  const fixturesPath2 = path.resolve(
    __dirname,
    `../../${builder}/test/fixtures`,
  );

  // eslint-disable-next-line no-restricted-syntax
  for (const fixture of fs.readdirSync(fixturesPath2)) {
    // don't run all foreign fixtures, just some
    if (['01-cowsay', '01-cache-headers', '03-env-vars'].includes(fixture)) {
      // eslint-disable-next-line no-loop-func
      it(`should build ${builder}/${fixture}`, async () => {
        await expect(
          testDeployment(
            { builderUrl, buildUtilsUrl },
            path.join(fixturesPath2, fixture),
          ),
        ).resolves.toBeDefined();
      });
    }
  }
}

it('Test `detectBuilders`', async () => {
  {
    // package.json + no build
    const pkg = { dependencies: { next: '9.0.0' } };
    const files = ['package.json', 'pages/index.js', 'public/index.html'];
    const { builders, errors } = await detectBuilders(files, pkg);
    expect(builders).toBe(null);
    expect(errors.length).toBe(1);
  }

  {
    // package.json + no build + next
    const pkg = {
      scripts: { build: 'next build' },
      dependencies: { next: '9.0.0' },
    };
    const files = ['package.json', 'pages/index.js'];
    const { builders, errors } = await detectBuilders(files, pkg);
    expect(builders[0].use).toBe('@now/next');
    expect(errors).toBe(null);
  }

  {
    // package.json + no build + next
    const pkg = {
      scripts: { build: 'next build' },
      devDependencies: { next: '9.0.0' },
    };
    const files = ['package.json', 'pages/index.js'];
    const { builders, errors } = await detectBuilders(files, pkg);
    expect(builders[0].use).toBe('@now/next');
    expect(errors).toBe(null);
  }

  {
    // package.json + no build
    const pkg = {};
    const files = ['package.json'];
    const { builders, errors } = await detectBuilders(files, pkg);
    expect(builders).toBe(null);
    expect(errors.length).toBe(1);
  }

  {
    // static file
    const files = ['index.html'];
    const { builders, errors } = await detectBuilders(files);
    expect(builders).toBe(null);
    expect(errors).toBe(null);
  }

  {
    // no package.json + public
    const files = ['api/users.js', 'public/index.html'];
    const { builders, errors } = await detectBuilders(files);
    expect(builders[1].use).toBe('@now/static');
    expect(errors).toBe(null);
  }

  {
    // no package.json + no build + raw static + api
    const files = ['api/users.js', 'index.html'];
    const { builders, errors } = await detectBuilders(files);
    expect(builders[0].use).toBe('@now/node');
    expect(builders[0].src).toBe('api/users.js');
    expect(builders[1].use).toBe('@now/static');
    expect(builders[1].src).toBe('index.html');
    expect(builders.length).toBe(2);
    expect(errors).toBe(null);
  }

  {
    // package.json + no build + root + api
    const files = ['index.html', 'api/[endpoint].js', 'static/image.png'];
    const { builders, errors } = await detectBuilders(files);
    expect(builders[0].use).toBe('@now/node');
    expect(builders[0].src).toBe('api/[endpoint].js');
    expect(builders[1].use).toBe('@now/static');
    expect(builders[1].src).toBe('index.html');
    expect(builders[2].use).toBe('@now/static');
    expect(builders[2].src).toBe('static/image.png');
    expect(builders.length).toBe(3);
    expect(errors).toBe(null);
  }

  {
    // api + ignore files
    const files = [
      'api/_utils/handler.js',
      'api/[endpoint]/.helper.js',
      'api/[endpoint]/[id].js',
    ];

    const { builders } = await detectBuilders(files);
    expect(builders[0].use).toBe('@now/node');
    expect(builders[0].src).toBe('api/[endpoint]/[id].js');
    expect(builders.length).toBe(1);
  }

  {
    // api + next + public
    const pkg = {
      scripts: { build: 'next build' },
      devDependencies: { next: '9.0.0' },
    };
    const files = ['package.json', 'api/endpoint.js', 'public/index.html'];

    const { builders } = await detectBuilders(files, pkg);
    expect(builders[0].use).toBe('@now/node');
    expect(builders[0].src).toBe('api/endpoint.js');
    expect(builders[1].use).toBe('@now/next');
    expect(builders[1].src).toBe('package.json');
    expect(builders.length).toBe(2);
  }

  {
    // api + next + raw static
    const pkg = {
      scripts: { build: 'next build' },
      devDependencies: { next: '9.0.0' },
    };
    const files = ['package.json', 'api/endpoint.js', 'index.html'];

    const { builders } = await detectBuilders(files, pkg);
    expect(builders[0].use).toBe('@now/node');
    expect(builders[0].src).toBe('api/endpoint.js');
    expect(builders[1].use).toBe('@now/next');
    expect(builders[1].src).toBe('package.json');
    expect(builders.length).toBe(2);
  }

  {
    // api + raw static
    const files = ['api/endpoint.js', 'index.html', 'favicon.ico'];

    const { builders } = await detectBuilders(files);
    expect(builders[0].use).toBe('@now/node');
    expect(builders[0].src).toBe('api/endpoint.js');
    expect(builders[1].use).toBe('@now/static');
    expect(builders[1].src).toBe('favicon.ico');
    expect(builders[2].use).toBe('@now/static');
    expect(builders[2].src).toBe('index.html');
    expect(builders.length).toBe(3);
  }

  {
    // api + public
    const files = [
      'api/endpoint.js',
      'public/index.html',
      'public/favicon.ico',
      'README.md',
    ];

    const { builders } = await detectBuilders(files);
    expect(builders[0].use).toBe('@now/node');
    expect(builders[0].src).toBe('api/endpoint.js');
    expect(builders[1].use).toBe('@now/static');
    expect(builders[1].src).toBe('public/**/*');
    expect(builders.length).toBe(2);
  }

  {
    // just public
    const files = ['public/index.html', 'public/favicon.ico', 'README.md'];

    const { builders } = await detectBuilders(files);
    expect(builders[0].src).toBe('public/**/*');
    expect(builders.length).toBe(1);
  }

  {
    // next + public
    const pkg = {
      scripts: { build: 'next build' },
      devDependencies: { next: '9.0.0' },
    };
    const files = ['package.json', 'public/index.html', 'README.md'];

    const { builders } = await detectBuilders(files, pkg);
    expect(builders[0].use).toBe('@now/next');
    expect(builders[0].src).toBe('package.json');
    expect(builders.length).toBe(1);
  }

  {
    // nuxt
    const pkg = {
      scripts: { build: 'nuxt build' },
      dependencies: { nuxt: '2.8.1' },
    };
    const files = ['package.json', 'pages/index.js'];

    const { builders } = await detectBuilders(files, pkg);
    expect(builders[0].use).toBe('@now/static-build');
    expect(builders[0].src).toBe('package.json');
    expect(builders.length).toBe(1);
  }

  {
    // package.json with no build + api
    const pkg = { dependencies: { next: '9.0.0' } };
    const files = ['package.json', 'api/[endpoint].js'];

    const { builders } = await detectBuilders(files, pkg);
    expect(builders[0].use).toBe('@now/node');
    expect(builders[0].src).toBe('api/[endpoint].js');
    expect(builders.length).toBe(1);
  }

  {
    // package.json with no build + public directory
    const pkg = { dependencies: { next: '9.0.0' } };
    const files = ['package.json', 'public/index.html'];

    const { builders, errors } = await detectBuilders(files, pkg);
    expect(builders).toBe(null);
    expect(errors.length).toBe(1);
  }

  {
    // no package.json + api
    const files = ['api/[endpoint].js', 'api/[endpoint]/[id].js'];

    const { builders } = await detectBuilders(files);
    expect(builders.length).toBe(2);
  }

  {
    // no package.json + no api
    const files = ['index.html'];

    const { builders, errors } = await detectBuilders(files);
    expect(builders).toBe(null);
    expect(errors).toBe(null);
  }

  {
    // package.json + api + canary
    const pkg = {
      scripts: { build: 'next build' },
      dependencies: { next: '9.0.0' },
    };
    const files = [
      'pages/index.js',
      'api/[endpoint].js',
      'api/[endpoint]/[id].js',
    ];

    const { builders } = await detectBuilders(files, pkg, { tag: 'canary' });
    expect(builders[0].use).toBe('@now/node@canary');
    expect(builders[1].use).toBe('@now/node@canary');
    expect(builders[2].use).toBe('@now/next@canary');
    expect(builders.length).toBe(3);
  }
});

it('Test `detectRoutes`', async () => {
  {
    const files = ['api/user.go', 'api/team.js', 'api/package.json'];

    const { builders } = await detectBuilders(files);
    const { defaultRoutes } = await detectRoutes(files, builders);
    expect(defaultRoutes.length).toBe(3);
    expect(defaultRoutes[0].dest).toBe('/api/team.js');
    expect(defaultRoutes[1].dest).toBe('/api/user.go');
    expect(defaultRoutes[2].dest).not.toBeDefined();
    expect(defaultRoutes[2].status).toBe(404);
  }

  {
    const files = ['api/user.go', 'api/user.js'];

    const { builders } = await detectBuilders(files);
    const { error } = await detectRoutes(files, builders);
    expect(error.code).toBe('conflicting_file_path');
  }

  {
    const files = ['api/[user].go', 'api/[team]/[id].js'];

    const { builders } = await detectBuilders(files);
    const { error } = await detectRoutes(files, builders);
    expect(error.code).toBe('conflicting_file_path');
  }

  {
    const files = ['api/[team]/[team].js'];

    const { builders } = await detectBuilders(files);
    const { error } = await detectRoutes(files, builders);
    expect(error.code).toBe('conflicting_path_segment');
  }

  {
    const files = ['api/date/index.js', 'api/date/index.go'];

    const { builders } = await detectBuilders(files);
    const { defaultRoutes, error } = await detectRoutes(files, builders);
    expect(defaultRoutes).toBe(null);
    expect(error.code).toBe('conflicting_file_path');
  }

  {
    const files = ['api/[endpoint].js', 'api/[endpoint]/[id].js'];

    const { builders } = await detectBuilders(files);
    const { defaultRoutes } = await detectRoutes(files, builders);
    expect(defaultRoutes.length).toBe(3);
  }

  {
    const files = [
      'public/index.html',
      'api/[endpoint].js',
      'api/[endpoint]/[id].js',
    ];

    const { builders } = await detectBuilders(files);
    const { defaultRoutes } = await detectRoutes(files, builders);
    expect(defaultRoutes[2].status).toBe(404);
    expect(defaultRoutes[2].src).toBe('/api(\\/.*)?$');
    expect(defaultRoutes[3].src).toBe('/(.*)');
    expect(defaultRoutes[3].dest).toBe('/public/$1');
    expect(defaultRoutes.length).toBe(4);
  }

  {
    const pkg = {
      scripts: { build: 'next build' },
      devDependencies: { next: '9.0.0' },
    };
    const files = ['public/index.html', 'api/[endpoint].js'];

    const { builders } = await detectBuilders(files, pkg);
    const { defaultRoutes } = await detectRoutes(files, builders);
    expect(defaultRoutes[1].status).toBe(404);
    expect(defaultRoutes[1].src).toBe('/api(\\/.*)?$');
    expect(defaultRoutes.length).toBe(2);
  }

  {
    const files = ['public/index.html'];

    const { builders } = await detectBuilders(files);
    const { defaultRoutes } = await detectRoutes(files, builders);

    expect(defaultRoutes.length).toBe(1);
  }

  {
    const files = ['api/date/index.js', 'api/date.js'];

    const { builders } = await detectBuilders(files);
    const { defaultRoutes } = await detectRoutes(files, builders);

    expect(defaultRoutes.length).toBe(3);
    expect(defaultRoutes[0].src).toBe(
      '^/api/date(\\/|\\/index|\\/index\\.js)?$',
    );
    expect(defaultRoutes[0].dest).toBe('/api/date/index.js');
    expect(defaultRoutes[1].src).toBe('^/api/(date|date\\.js)$');
    expect(defaultRoutes[1].dest).toBe('/api/date.js');
  }

  {
    const files = ['api/date.js', 'api/[date]/index.js'];

    const { builders } = await detectBuilders(files);
    const { defaultRoutes } = await detectRoutes(files, builders);

    expect(defaultRoutes.length).toBe(3);
    expect(defaultRoutes[0].src).toBe(
      '^/api/([^\\/]+)(\\/|\\/index|\\/index\\.js)?$',
    );
    expect(defaultRoutes[0].dest).toBe('/api/[date]/index.js?date=$1');
    expect(defaultRoutes[1].src).toBe('^/api/(date|date\\.js)$');
    expect(defaultRoutes[1].dest).toBe('/api/date.js');
  }

  {
    const files = [
      'api/index.ts',
      'api/index.d.ts',
      'api/users/index.ts',
      'api/users/index.d.ts',
      'api/food.ts',
      'api/ts/gold.ts',
    ];
    const { builders } = await detectBuilders(files);
    const { defaultRoutes } = await detectRoutes(files, builders);

    expect(builders.length).toBe(4);
    expect(builders[0].use).toBe('@now/node');
    expect(builders[1].use).toBe('@now/node');
    expect(builders[2].use).toBe('@now/node');
    expect(builders[3].use).toBe('@now/node');
    expect(defaultRoutes.length).toBe(5);
  }
});

it('Test `detectBuilders` and `detectRoutes`', async () => {
  const fixture = path.join(__dirname, 'fixtures', '01-zero-config-api');
  const pkg = await fs.readJSON(path.join(fixture, 'package.json'));
  const fileList = await glob('**', fixture);
  const files = Object.keys(fileList);

  const probes = [
    {
      path: '/api/my-endpoint',
      mustContain: 'my-endpoint',
      status: 200,
    },
    {
      path: '/api/other-endpoint',
      mustContain: 'other-endpoint',
      status: 200,
    },
    {
      path: '/api/team/zeit',
      mustContain: 'team/zeit',
      status: 200,
    },
    {
      path: '/api/user/myself',
      mustContain: 'user/myself',
      status: 200,
    },
    {
      path: '/api/not-okay/',
      status: 404,
    },
    {
      path: '/api',
      status: 404,
    },
    {
      path: '/api/',
      status: 404,
    },
    {
      path: '/',
      mustContain: 'hello from index.txt',
    },
  ];

  const { builders } = await detectBuilders(files, pkg);
  const { defaultRoutes } = await detectRoutes(files, builders);

  const nowConfig = { builds: builders, routes: defaultRoutes, probes };
  await fs.writeFile(
    path.join(fixture, 'now.json'),
    JSON.stringify(nowConfig, null, 2),
  );

  const deployment = await testDeployment(
    { builderUrl, buildUtilsUrl },
    fixture,
  );
  expect(deployment).toBeDefined();
});

it('Test `detectBuilders` and `detectRoutes` with `index` files', async () => {
  const fixture = path.join(__dirname, 'fixtures', '02-zero-config-api');
  const pkg = await fs.readJSON(path.join(fixture, 'package.json'));
  const fileList = await glob('**', fixture);
  const files = Object.keys(fileList);

  const probes = [
    {
      path: '/api/not-okay',
      status: 404,
    },
    {
      path: '/api',
      mustContain: 'hello from api/index.js',
      status: 200,
    },
    {
      path: '/api/',
      mustContain: 'hello from api/index.js',
      status: 200,
    },
    {
      path: '/api/index',
      mustContain: 'hello from api/index.js',
      status: 200,
    },
    {
      path: '/api/index.js',
      mustContain: 'hello from api/index.js',
      status: 200,
    },
    {
      path: '/api/date.js',
      mustContain: 'hello from api/date.js',
      status: 200,
    },
    {
      // Someone might expect this to be `date.js`,
      // but I doubt that there is any case were both
      // `date/index.js` and `date.js` exists,
      // so it is not special cased
      path: '/api/date',
      mustContain: 'hello from api/date/index.js',
      status: 200,
    },
    {
      path: '/api/date/',
      mustContain: 'hello from api/date/index.js',
      status: 200,
    },
    {
      path: '/api/date/index',
      mustContain: 'hello from api/date/index.js',
      status: 200,
    },
    {
      path: '/api/date/index.js',
      mustContain: 'hello from api/date/index.js',
      status: 200,
    },
    {
      path: '/',
      mustContain: 'hello from index.txt',
    },
  ];

  const { builders } = await detectBuilders(files, pkg);
  const { defaultRoutes } = await detectRoutes(files, builders);

  const nowConfig = { builds: builders, routes: defaultRoutes, probes };
  await fs.writeFile(
    path.join(fixture, 'now.json'),
    JSON.stringify(nowConfig, null, 2),
  );

  const deployment = await testDeployment(
    { builderUrl, buildUtilsUrl },
    fixture,
  );
  expect(deployment).toBeDefined();
});

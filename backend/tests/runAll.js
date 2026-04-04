const path = require('path');

const tests = [
  './unit.fileExtraction.test',
  './unit.requestNormalizer.test',
  './unit.contextBuilder.test',
  './unit.openai-api.test',
  './unit.audio-pipeline.test',
  './contract.api-shape.test',
  './integration.orchestrator-flows.test',
  './prompt-regression-fixtures.test',
  './pipeline.check'
];

async function run() {
  for (const testPath of tests) {
    const mod = require(path.join(__dirname, testPath));
    if (typeof mod.run !== 'function') {
      throw new Error(`Test module ${testPath} must export run()`);
    }
    await mod.run();
    console.log(`[pass] ${testPath}`);
  }
  console.log('All backend tests passed.');
}

run().catch((error) => {
  console.error('Backend test suite failed:', error);
  process.exit(1);
});

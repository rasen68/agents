import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const { createJiti } = createRequire(import.meta.resolve('@earendil-works/pi-coding-agent'))('jiti');
const { resolveChildSessionOptions } = await createJiti(import.meta.url).import('../index.ts');
const models = ['gpt-daybreak-blue', 'gpt-6-astra', 'gpt-6-luna', 'gpt-6.1-sol'].map(id => ({provider: 'openai', id, name: id}));
const patterns = models.slice(1).map(model => `${model.provider}/${model.id}`);

function services(enabled = patterns) {
  return {
    settingsManager: {
      getEnabledModels: () => enabled,
      getDefaultProvider: () => 'openai',
      getDefaultModel: () => 'gpt-6.1-sol',
    },
    modelRuntime: {
      getAvailable: async () => models,
      getModel: (provider, id) => models.find(model => model.provider === provider && model.id === id),
    },
  };
}

for (const existing of [false, true]) {
  test(`child ${existing ? 'resumed' : 'new'} session cycles only enabled models using Pi 1.4 runtime services`, async () => {
    const manager = {buildSessionContext: () => ({messages: existing ? [{role: 'user'}] : []})};
    const options = await resolveChildSessionOptions(services(), manager, {sessionOptions: {model: models[1], thinkingLevel: 'high'}});
    assert.deepEqual(options.scopedModels.map(({model}) => model.id), models.slice(1).map(model => model.id));
    if (existing) {
      assert.equal(options.model, undefined);
      assert.equal(options.thinkingLevel, undefined);
    } else {
      assert.equal(options.model, models[1]);
      assert.equal(options.thinkingLevel, 'high');
    }
  });
}

test('new session prefers saved scoped default when the inherited model is outside the scope', async () => {
  const options = await resolveChildSessionOptions(services(), {}, {sessionOptions: {model: models[0]}});
  assert.equal(options.model, models[3]);
});

test('without an enabled-model scope, inherited selection remains unchanged', async () => {
  const options = await resolveChildSessionOptions(services([]), {}, {sessionOptions: {model: models[0]}});
  assert.equal(options.model, models[0]);
  assert.equal(options.scopedModels, undefined);
});

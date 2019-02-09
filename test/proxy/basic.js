const trans = require('../helper/transagent');
const Proxy = require('../../src/proxy');
const assert = require('assert');

describe('proxy.basic', () => {
  it('request and response must be properly proxied', async () => {
    let { clientReceived, serverReceived } =
    await trans(new Proxy())
      .post('/page?id=123')
      .send('Topic 123...')
      .set('X-Extended-Key', 'xyz')
      .reply({
        statusCode: 500,
        statusMessage: 'Internal Database Error',
        headers: {
          'X-Res-Data': '1234abcd'
        },
        body: 'update topic failed'
      })
      .ok(res => res.status === 500);

    assert.strictEqual(serverReceived.method, 'POST');
    assert.strictEqual(serverReceived.path, '/page?id=123');
    assert.strictEqual(serverReceived.headers['X-Extended-Key'], 'xyz');
    assert.strictEqual(serverReceived.text, 'Topic 123...');

    assert.strictEqual(clientReceived.statusCode, 500);
    assert.strictEqual(clientReceived.statusMessage, 'Internal Database Error');
    assert.strictEqual(clientReceived.headers['X-Res-Data'], '1234abcd');
    assert.strictEqual(clientReceived.text, 'update topic failed');
  });
});

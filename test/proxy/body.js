const trans = require('../helper/transagent');
const Proxy = require('../../src/proxy');
const assert = require('assert');

describe('proxy.body.modify', () => {
  it('modify request body', async () => {
    let proxy = new Proxy();
    proxy.on('request', req => {
      req.tamper = body => JSON.stringify({ msg: body.toString() });
    });

    let { serverReceived } =
    await trans(proxy)
      .post('/proxy/modify-request-body')
      .send('xxx')
      .reply('ok');

    assert.strictEqual(serverReceived.text, '{"msg":"xxx"}');
  });

  it('modify response body', async () => {
    let proxy = new Proxy();
    proxy.on('response', res => {
      res.tamper = body => JSON.stringify({ msg: body.toString() });
    });

    let { clientReceived } =
    await trans(proxy)
      .get('/proxy/modify-response-body')
      .reply('ok');

    assert.strictEqual(clientReceived.text, '{"msg":"ok"}');
  });
});

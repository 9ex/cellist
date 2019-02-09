const trans = require('../helper/transagent');
const Proxy = require('../../src/proxy');
const assert = require('assert');

describe('proxy.async', () => {
  it('delay request', async () => {
    let delay = 200;
    let proxy = new Proxy();
    proxy.on('request', req => {
      req.tamper = () => new Promise(resolve => setTimeout(resolve, delay));
    });

    let startTime = Date.now();
    await trans(proxy)
      .get('/proxy/delay-request')
      .reply('ok');

    let cost = Date.now() - startTime;
    if (cost < delay) {
      assert.fail(`should delay ${delay}ms, actually cost ${cost}ms`);
    }
  });
});

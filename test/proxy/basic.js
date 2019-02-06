const trans = require('../helper/transagent');
const Proxy = require('../../src/proxy');
const assert = require('assert');

describe('proxy.basic', () => {
    it('Request and response must be properly proxied', async () => {
        trans(new Proxy())
            .post('/page?id=123')
            .send('Topic 123...')
            .set('X-Extended-Key', 'xyz')
            .reply({
                statusCode: 500,
                statusMessage: 'Internal Database Error',
                headers: { 'X-Res-Data': '1234abcd' },
                body: 'update topic failed'
            })
            .ok(res => res.status === 500)
            .end((err, clientReceived, serverReceived) => {
                assert.ifError(err);
                
                assert.ifError(serverReceived.error);
                assert.equal(serverReceived.method, 'POST');
                assert.equal(serverReceived.path, '/page?id=123');
                assert.equal(serverReceived.headers['X-Extended-Key'], 'xyz');
                assert.equal(serverReceived.text, 'Topic 123...');

                assert.equal(clientReceived.statusCode, 500);
                assert.equal(clientReceived.statusMessage, 'Internal Database Error');
                assert.equal(clientReceived.headers['X-Res-Data'], '1234abcd');
                assert.equal(clientReceived.text, 'update topic failed')
            });
    });
});
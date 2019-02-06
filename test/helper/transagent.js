const http = require('http');
const superagent = require('superagent');
const proxyAgent = require('proxy-agent');
const Agent = superagent.agent;
const Proxy = require('../../src/proxy');
const Request = superagent.Request;
const Response = superagent.Response;

class TransAgent extends Agent {
    constructor(proxy) {
        super();
        this.proxy = proxy;
    }
}

http.METHODS.forEach(method => {
    TransAgent.prototype[method.toLowerCase()] = function (path) {
        let req = new Transceiver(this.proxy, method, path);

        req.on('response', this._saveCookies.bind(this));
        req.on('redirect', this._saveCookies.bind(this));
        req.on('redirect', this._attachCookies.bind(this, req));
        this._attachCookies(req);

        return req;
    };
});

Object.defineProperty(Response.prototype, 'headers', {
    get: function () {
        return this._headers;
    },
    set: function () {
        this._headers = getHeaders(this.res.rawHeaders);
    }
});
Response.prototype.headers

class Transceiver extends Request {
    constructor(proxy, method, path) {
        super(method.toUpperCase(), path);
        this.redirects(0);
        this.buffer();
        this.proxy = proxy;
        let server = new MockServer();
        server.listen();
        this.server = server;
        this.url = `${getUrl(server.address())}${path}`;
        if (proxy instanceof Proxy && !proxy.listening) {
            proxy.listen();
            this.agent(proxyAgent(getUrl(proxy.address())));
        } else if (typeof proxy === 'string') {
            this.agent(proxyAgent(proxy));
        }
    }
    reply(options) {
        this.server.reply(options);
        return this;
    }
    end(fn) {
        super.end((err, res) => {
            this.server.close();
            if (this.proxy instanceof Proxy) {
                this.proxy.close();
            }
            fn(err, res, this.server.request);
        });
        return this;
    }
}

class MockServer {
    constructor() {
        this._server = http.createServer();
    }
    reply(options) {
        if (typeof options === 'string') {
            options = {
                body: options
            };
        }
        this._server.once('request', async (req, res) => {
            try {
                let request = {
                    httpVersion: req.httpVersion,
                    method: req.method,
                    path: req.url,
                    headers: getHeaders(req.rawHeaders)
                };
                let body = await readAll(req);
                request.body = body;
                request.text = body.toString();
                if (/\/json\b/i.test(req.headers['content-type'])) {
                    try {
                        request.obj = JSON.parse(request.text);
                    } catch (e) {}
                }
                if (options.statusMessage) {
                    res.statusMessage = options.statusMessage;
                }
                res.httpVersion = options.httpVersion;
                res.writeHead(options.statusCode || 200, options.headers || {});
                res.end(options.body || '');
                this.request = request;
            } catch (err) {
                this.request = {
                    error: err
                };
            }
        });
    }
    listen(port = 0, host, done) {
        this._server.listen(port, host, done);
    }
    address() {
        return this._server.address();
    }
    close(done) {
        this._server.close(done);
    }
}

function getHeaders(rawHeaders) {
    let headers = {};
    for (let i = 0; i < rawHeaders.length; i += 2) {
        let name = rawHeaders[i];
        let value = rawHeaders[i + 1];
        if (name in headers) {
            if (headers[name] instanceof Array) {
                headers[name].push(value);
            } else {
                headers[name] = [headers[name], value];
            }
        } else {
            headers[name] = value;
        }
    }
    return headers;
}

function getUrl(addr, protocol) {
    if (!addr) {
        throw new TypeError('invalid address');
    }

    let host;
    if (addr.family === 'IPv4') {
        host = addr.address === '0.0.0.0' ? '127.0.0.1' : addr.address;
    } else {
        host = `[${addr.address === '::' ? '::1' : addr.address}]`;
    }
    return `${protocol || 'http'}://${host}:${addr.port}`;
}

function readAll(stream) {
    return new Promise((resolve, reject) => {
        let chunks = [];
        stream.on('data', d => chunks.push(d));
        stream.once('error', reject);
        stream.once('end', () => resolve(Buffer.concat(chunks)));
    });
}

module.exports = exports = proxy => new TransAgent(proxy);
exports.TransAgent = TransAgent;
exports.Transceiver = Transceiver;
exports.MockServer = MockServer;
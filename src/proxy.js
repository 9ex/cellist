const http = require('http');
const EventEmitter = require('events');
const ReadableStream = require('stream').Readable;

const DEFAULT_TIMEOUT = 2 * 3600 * 1000;
const MAX_BUFFER_SIZE = 4 * 1024 * 1024;

const OPTIONS = Symbol('options');
const RAW = Symbol('raw');
const HEADERS = Symbol('headers');
const GREEDY = Symbol('greedy');
const TAMPER = Symbol('tamper');
const RESPONDER = Symbol('responder');

/**
 * core service
 */
class Proxy extends EventEmitter {
  constructor() {
    super();

    this[OPTIONS] = {};
  }

  /**
   * @type {number}
   * @readonly
   */
  address() {
    let server = this[OPTIONS].server;
    return server && server.address();
  }

  /**
   * @type {bool}
   * @readonly
   */
  get listening() {
    let server = this[OPTIONS].server;
    return server && server.listening;
  }

  /**
   * Starts the service listening for connections
   */
  listen(port = 0, host, done) {
    if (this.listening) {
      done && done(new Error('This instance has already started.'));
      return;
    }
    try {
      let opt = this[OPTIONS];
      opt.server = http.createServer()
        .on('request', processRequest.bind(undefined, this))
        .on('clientError', (err, socket) => {
          this.emit('error', err);
          socket && socket.end();
        })
        .on('connection', socket => {
          socket.setNoDelay();
        });
      opt.server.timeout = DEFAULT_TIMEOUT;
      opt.server.listen({
        port,
        host
      }, () => {
        done && done(null, opt.server.address());
      });
    } catch (err) {
      done && done(err);
    }
  }

  /**
   * Stops service from accepting new connections and keeps existing connections.
   */
  close(done) {
    let opt = this[OPTIONS];
    if (!this.listening) {
      done && done(new Error('Proxy isn\'t started'));
    }
    opt.server.close(err => {
      if (err) {
        done && done(err);
      } else {
        delete opt.server;
        done && done();
      }
    });
  }
}

class Message {
  constructor(msg) {
    this[RAW] = msg;

    let rawHeaders = msg.rawHeaders;
    let headers = {};
    for (let i = 0; i < rawHeaders.length; i += 2) {
      let name = rawHeaders[i];
      let lname = name.toLowerCase();
      let header = headers[lname];
      if (!header) {
        header = headers[lname] = {
          name,
          values: []
        };
      }
      header.values.push(rawHeaders[i + 1]);
    }
    this[HEADERS] = headers;

    this.httpVersion = msg.httpVersion || '1.1';
    this[GREEDY] = false;
    this[TAMPER] = null;
    this[RESPONDER] = null;
  }

  /**
   * get header value
   * @param {string} name
   */
  header(name) {
    if (!name || typeof name !== 'string') {
      throw new TypeError('name must be a string');
    }

    let lname = name.toLowerCase();
    let header = this[HEADERS][lname];
    return header ? header.values : undefined;
  }

  /**
   * set header value
   * @param {string} name
   * @param {string|string[]} value
   */
  setHeader(name, value) {
    if (!name || typeof name !== 'string') {
      throw new TypeError('name must be a string');
    }

    let headers = this[HEADERS];
    let lname = name.toLowerCase();
    let header = headers[lname];
    if (!header) {
      header = headers[lname] = {
        name,
        values: []
      };
    }
    if (typeof value === 'string') {
      header.values.push(value);
    } else if (value instanceof Array && value.every(v => typeof v === 'string')) {
      header.values = value;
    } else {
      throw new TypeError('value must be a string or string[]');
    }
  }

  /**
   * get headers
   */
  get headers() {
    let headers = this[HEADERS];
    let result = {};
    for (let key in headers) {
      let header = headers[key];
      let count = header.values.length;
      if (count === 1) {
        result[header.name] = header.values[0];
      } else if (count > 1) {
        result[header.name] = header.values;
      }
    }
    return result;
  }

  addTamper(handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('tamper handler must be a function');
    }
    let handlers = this[TAMPER];
    if (!handlers) {
      handlers = this[TAMPER] = [];
    }
    handlers.push(handler);
  }

  addResponder(handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('responder handler must be a function');
    }
    let handlers = this[RESPONDER];
    if (!handlers) {
      handlers = this[RESPONDER] = [];
    }
    handlers.push(handler);
  }

  get greedy() {
    if (this[TAMPER]) {
      return true;
    } else {
      return this[GREEDY];
    }
  }
  set greedy(val) {
    if (typeof val === 'boolean') {
      this[GREEDY] = val;
    }
  }
}

class Request extends Message {
  constructor(msg) {
    super(msg);

    let url = new URL(msg.url);
    this.method = msg.method;
    this.path = `${url.pathname}${url.search}`;
    this.host = url.host || this.header('host');
    this.url = `http://${this.host}${this.path}`;

    let m = this.host.match(/^(.+)(?::(\d+))$/i);
    if (m) {
      if (m[1][0] === '[') {
        this.hostname = m[1].slice(1, -1);
      } else {
        this.hostname = m[1];
      }
      this.port = Number(m[2]);
    } else {
      this.hostname = this.host;
      this.port = 80;
    }
  }
}

class Response extends Message {
  constructor(msg, request) {
    super(msg);

    this.statusCode = msg.statusCode;
    this.statusMessage = msg.statusMessage;

    this.request = request instanceof Request ? request : null;
  }
}

async function processRequest(service, reader, writer) {
  try {
    receive({
      service,
      reader,
      writer
    });
  } catch (err) {
    // todo: error handling
  }
}

async function receive(ctx) {
  // todo: max size limit
  // todo: pause
  let req = new Request(ctx.reader);
  ctx.service.emit('request', req);

  let {
    res,
    resBody,
    srcBody
  } = await executeExtensions(req);
  if (res) {
    reply(ctx, res, resBody);
  } else {
    invoke(ctx, req, srcBody);
  }
}

async function invoke(ctx, req, reqBody) {
  let options = {
    host: req.host,
    hostname: req.hostname,
    port: req.port,
    method: req.method,
    headers: req.headers,
    path: req.path
  };
  let replier = await sendRequest(options, reqBody || req[RAW]);
  let res = new Response(replier);
  ctx.service.emit('response', res);

  let {
    res: res2,
    resBody,
    srcBody
  } = await executeExtensions(res);
  reply(ctx, res2 || res, resBody || srcBody);
}

function reply(ctx, res, body) {
  let writer = ctx.writer;
  if (res.statusMessage) {
    writer.statusMessage = res.statusMessage;
  }
  writer.writeHead(res.statusCode, res.headers);
  if (typeof body === 'string' || body instanceof Buffer) {
    writer.end(body);
  } else {
    res[RAW].pipe(writer);
  }
}

async function executeExtensions(msg) {
  let res;
  let resBody;
  let srcBody;

  if (msg.greedy) {
    srcBody = await readAll(msg[RAW], MAX_BUFFER_SIZE);
  }
  if (typeof msg.tamper === 'function') {
    let ret = await msg.tamper(srcBody, msg);
    if (typeof ret === 'string' || ret instanceof Buffer) {
      srcBody = ret;
    }
  }
  if (typeof msg.responder === 'function') {
    let ret = await msg.responder(srcBody, msg);
    if (ret && typeof ret === 'object') {
      if (!ret.headers) {
        ret.headers = {};
      }
      if (!ret.statusCode) {
        ret.statusCode = 200;
      }
      res = new Response(ret);
      if (typeof ret.body === 'string' || ret.body instanceof Buffer) {
        resBody = ret.body;
      } else {
        resBody = '';
      }
    }
  }
  return {
    res,
    resBody,
    srcBody
  };
}

function sendRequest(options, data) {
  return new Promise((resolve, reject) => {
    let req = http.request(options, resolve);
    req.setNoDelay();
    req.on('error', reject);
    req.setTimeout(DEFAULT_TIMEOUT, () => reject(new Error('Request timeout')));
    if (typeof data === 'string' || data instanceof Buffer) {
      req.end(data);
    } else if (data instanceof ReadableStream) {
      data.pipe(req);
    } else {
      req.end();
    }
  });
}

function readAll(stream, sizeLimit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let chunks = [];
    stream.on('data', d => {
      size += d.length;
      if (size > sizeLimit) {
        reject(new Error(''));
        return;
      }
      chunks.push(d);
    });
    stream.once('error', reject);
    stream.once('end', () => resolve(Buffer.concat(chunks)));
  });
}

module.exports = Proxy;

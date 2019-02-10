const http = require('http');
const EventEmitter = require('events');
const handler = require('./handler');

const DEFAULT_TIMEOUT = 2 * 3600 * 1000;

const OPTIONS = Symbol('options');

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
    if (server && server.listening) {
      return true;
    } else {
      return false;
    }
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
        .on('request', handler.request.bind(undefined, this))
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

module.exports = Proxy;

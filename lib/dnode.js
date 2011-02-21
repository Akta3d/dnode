var net = require('net');
var EventEmitter = require('events').EventEmitter;
var Hash = require('hashish');
var recon = require('recon');

var http = require('http');
var io = require('socket.io');

var Conn = require('./conn');
var WebSrc = require('./web');
var StreamSocketIO = require('./stream_socketio');

module.exports = DNode;
module.exports.DNode = DNode;

function DNode (wrapper) {
    if (wrapper === undefined) wrapper = {};
    var self = new EventEmitter;
    
    self.stack = [];
    self.use = function (middleware) {
        self.stack.push(middleware);
        return self;
    };
    
    self.connect = function () {
        var params = parseArgs(arguments);
        var stream = params.stream;
        
        if (params.port) {
            if (params.reconnect) {
                stream = recon(params);
            }
            else {
                stream = net.createConnection(params.port, params.host);
            }
            stream.remoteAddress = params.host || '127.0.0.1';
            stream.remotePort = params.port;
        }
        
        var conn = self.withStream(stream, params, params.block);
        stream.on('error', conn.emit.bind(conn, 'localError'));
        
        self.end = function () {
            stream.end();
            self.emit('end');
            return self;
        };
        
        printErrors(self);
        return self;
    };
    
    var ready = false;
    var conns = [];
    
    self.withStream = function (stream, opts, block) {
        if (!ready) self.emit('ready');
        ready = true;
        
        var conn = new Conn(stream, wrapper);
        self.stack.forEach(function (middleware) {
            middleware.call(conn.instance, conn.remote, conn);
        });
        
        conn.on('remote', function (remote) {
            if (block) block.call(conn.instance, remote, conn);
        });
        
        conn.on('localError',function(err) {
            //required behaviour for test/asynct/error.asynct.js
            self.emit('localError',err);
        });
        conn.on('remoteError',function(err) {
            //required behaviour for test/asynct/error.asynct.js
            self.emit('remoteError',err);
        });
        
        conn.on('connect', function () { 
            conns.push(conn) 
            self.emit('connect', conn);
        });
        
        conn.on('end', function () {
            var i = conns.indexOf(conn);
            if (i >= 0) conns.splice(i,1);
        });
        
        return conn;
    };
    
    self.end = function () {
        self.emit('error', '.end() is not defined for this action');
        return self;
    };
    
    self.listen = function () {
        var params = parseArgs(arguments);
        var server = params.server;
        
        if (server instanceof io.Listener) {
            var stream = StreamSocketIO(function (s) {
                self.withStream(s, params, params.block);
            });
        }
        else if (server instanceof http.Server) {
            // http server to proxy socketIO connections with
            // this way works with both connect and express
            if (typeof server.use === 'function') {
                if (!('route' in params) || params.route) {
                    server.use(WebSrc.route(
                        params.route || '/dnode.js'
                    ));
                }
            }
            
            var sock = io.listen(server, params);
            StreamSocketIO(sock, function (stream) {
                self.withStream(stream, params, params.block);
            });
            
            ready = true;
            self.emit('ready');
        }
        else if (server instanceof net.Stream) {
            self.withStream(server, params, params.block);
        }
        else if (params.port) {
            server = net.createServer(function (stream) {
                self.withStream(stream, params, params.block);
            });
            server.on('error', self.emit.bind(self, 'localError'))
            server.listen(params.port, params.host, function () {
                ready = true;
                self.emit('ready')
            });
        }
        else {
            throw new Error('Not sure how to fire up this listener');
        }
        
        self.end = function () {
            conns.forEach(function (conn) { conn.end() });
            server.close();
            self.emit('end');
        };
        
        self.close = self.end;
        
        printErrors(self);
        return self;
    };
    
    return self;
}

// So DNode.connect and DNode().connect do the same thing:
DNode.connect = function () {
    var dnode = DNode();
    return dnode.connect.apply(dnode,[].concat.apply([],arguments));
};

function parseArgs (argv) {
    var params = {};
    
    [].slice.call(argv).forEach(function (arg) {
        if (typeof arg === 'string') {
            if (arg.match(/^\d+$/)) {
                params.port = arg;
            }
            else {
                params.host = arg;
            }
        }
        else if (typeof arg === 'number') {
            params.port = arg;
        }
        else if (typeof arg === 'function') {
            params.block = arg;
        }
        else if (typeof arg === 'object') {
            var serverTypes = [ http.Server, io.Listener, net.Server ];
            if (serverTypes.some(function (t) { return arg instanceof t })) {
                params.server = arg;
            }
            else if (arg instanceof net.Stream) {
                params.stream = arg;
            }
            else {
                Hash.update(params, arg);
            }
        }
        else if (typeof arg === 'undefined') {
            // ignore
        }
        else {
            throw new Error('Not sure what to do about '
                + typeof arg + ' objects');
        }
    });
    
    return params;
}

function printErrors (em) {
    // log the error if no listeners already bound on next tick
    process.nextTick(function () {
        if (em.listeners('localError').length === 0) {
            em.on('localError', function (err) {
                console.error(err.stack ? err.stack : err);
            });
        }
    });
}

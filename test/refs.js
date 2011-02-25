var DNode = require('dnode');
var sys = require('sys');

exports.refs = function (assert) {
    var port = Math.floor(Math.random() * 40000 + 10000);
    
    var server = DNode({
        a : 1,
        b : 2,
    }).listen(port);
    
    server.on('ready', function () {
        DNode.connect(port, function (remote, conn) {
            conn.end();
            server.close();
            assert.equal(
                remote.a, 1,
                'remote.a != 1, a = ' + sys.inspect(remote.a)
            );
            assert.equal(
                remote.b, 2,
                'remote.b != 2, b = ' + sys.inspect(remote.b)
            );
        });
    });
};

function Client(publicAddress, port) {
	this._publicAddress = publicAddress;
	this._port = port;
}

var proto = Client.prototype;

// proto.getDeposit = function() {
// 	return 0;
// }

module.exports = Client;
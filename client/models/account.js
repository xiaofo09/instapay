function Account(publicAddress, privateKey) {
	this._publicAddress = publicAddress;
	this._privateKey = privateKey;
	this._usedDeposit = 0;
}

var proto = Account.prototype;

proto.getDeposit = function() {
	return 0;
}

module.exports = Account;
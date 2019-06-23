function Payment(senderAddress, receiverAddress, amount, associatedAddrs, paymentData, date) {
	this._senderAddress = senderAddress;
	this._receiverAddress = receiverAddress;
	this._amount = amount;
	this._associatedAddrs = associatedAddrs;
	this._paymentData = paymentData;
	this._lockSignature = {};
	this._paymentSignature = {};
	this._lockAgreed = new Set();
	this._signAgreed = new Set();
	this._date = date;
}

var proto = Payment.prototype;

// proto.getDeposit = function() {
// 	return 0;
// }

module.exports = Payment;
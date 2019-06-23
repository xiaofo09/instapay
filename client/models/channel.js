function Channel(channelID, myAddress, myDeposit, otherAddress, otherDeposit, closeTimeInterval) {
	this._channelName = 0;
	this._channelID = channelID;
	this._status = 'READY';		// IDLE, LOCKED, SIGNED, CONFIRMED, CRASHED
	this._myAddress = myAddress;
	this._myDeposit = myDeposit;
	this._myBalance = myDeposit;
	this._otherAddress = otherAddress;
	this._otherDeposit = otherDeposit;
	this._otherBalance = otherDeposit;
	this._versionNumber = 0;
	this._closeTimeInterval = closeTimeInterval;
	this._otherPort = 0;		// client information
}

var proto = Channel.prototype;

proto.getDeposit = function() {
	return 100;
}


function OpeningRequest(channelID, openTimeout, closeTimeInterval) {
	this._channelName = 0;
	this._channelID = channelID;
	this._myAddress = 0;
	this._myDeposit = 0;
	this._otherAddress = 0;
	this._otherDeposit = 0;
	this._openTimeout = openTimeout;
	this._closeTimeInterval = closeTimeInterval;
}


function ClosingRequest(channelID, chalBalance, myBalance, versionNumber, closeTimeout) {
	this._channelID = channelID;
	this._chalBalance = chalBalance;
	this._myBalance = myBalance;
	this._versionNumber = versionNumber;
	this._closeTimeout = closeTimeout;
}


module.exports = {
	Channel:Channel,
	OpeningRequest:OpeningRequest,
	ClosingRequest:ClosingRequest
}
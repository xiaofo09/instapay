function Channel(channelID, aliceAddress, bobAddress, aliceDeposit, bobDeposit) {
	this._channelID = channelID
	this._aliceAddress = aliceAddress;
	this._bobAddress = bobAddress;
	this._aliceDeposit = aliceDeposit;
	this._bobDeposit = bobDeposit;
}

var proto = Channel.prototype;


module.exports = Channel;
var grpc = require('grpc');

const web3 = require('../config').web3;
const InstaPayContract = require('../config').contractInstance;
const contractAddress = require('../config').contractAddress;
var event = require('../config').event;
var myServer = require('../config').myServer;
var clientProto = require('../config').clientProto;
var server = require('../config').server;

const account = require('./account').account;
const Channel = require('../models').Channel.Channel;
const OpeningRequest = require('../models').Channel.OpeningRequest;
const ClosingRequest = require('../models').Channel.ClosingRequest;

const decode = require('./invoice').decode;

var sentOpnRequest = {};
var receivedOpnRequest = {};

var sentClsRequest = {};
var receivedClsRequest = {};
var closedChannel = {};

var channel = {};
var payment = '';


/* event construction */
event.on('data', e => {
	if(e.event == 'EventOpenChannel') {
		const id = e.returnValues.id;

		if (e.returnValues.bob in account) {
			receivedOpnRequest[id] = new OpeningRequest(id, e.returnValues.opn_timeout, e.returnValues.cls_delta);
			receivedOpnRequest[id]._myAddress = e.returnValues.bob;
			receivedOpnRequest[id]._otherAddress = e.returnValues.alice;
			receivedOpnRequest[id]._otherDeposit = web3.utils.fromWei(e.returnValues.alice_dep._hex, 'ether');
		}
		else if(e.returnValues.alice in account) {
			sentOpnRequest[id] = new OpeningRequest(id, e.returnValues.opn_timeout, e.returnValues.cls_delta);
			sentOpnRequest[id]._myAddress = e.returnValues.alice;
			sentOpnRequest[id]._myDeposit = web3.utils.fromWei(e.returnValues.alice_dep._hex, 'ether');
			sentOpnRequest[id]._otherAddress = e.returnValues.bob;
		}
	}
    else if(e.event == 'EventOpenChannelRespond') {
    	const id = e.returnValues.id;

		if (e.returnValues.bob in account) {
			channel[id] = new Channel(
				id,
				receivedOpnRequest[id]._myAddress,
				Number(receivedOpnRequest[id]._myDeposit),
				receivedOpnRequest[id]._otherAddress,
				Number(receivedOpnRequest[id]._otherDeposit),
				receivedOpnRequest[id]._closeTimeInterval
			);

			server.getClientInfo({address:channel[id]._otherAddress}, function(err, response) {
				channel[id]._otherPort = response.port;
			});

			delete receivedOpnRequest[id];
		}
		else if(e.returnValues.alice in account) {
			const otherDeposit = web3.utils.fromWei(e.returnValues.bob_dep._hex, 'ether');

			channel[id] = new Channel(
				id,
				sentOpnRequest[id]._myAddress,
				Number(sentOpnRequest[id]._myDeposit),
				sentOpnRequest[id]._otherAddress,
				Number(otherDeposit),
				sentOpnRequest[id]._closeTimeInterval
			);

			server.getClientInfo({address:channel[id]._otherAddress}, function(err, response) {
				channel[id]._otherPort = response.port;
			});

			delete sentOpnRequest[id];
		}
    }
    else if(e.event == 'EventCloseChannel') {
    	const id = e.returnValues.id;

    	if(id in channel && channel[id]._otherAddress == e.returnValues.challenger) {
    		var chalBalance = e.returnValues.bal1;
    		var myBalance = e.returnValues.bal2;
    		var versionNumber = e.returnValues.vn;
    		var closeTimeout = e.returnValues.cls_timeout;

    		receivedClsRequest[id] = new ClosingRequest(id, chalBalance, myBalance, versionNumber, closeTimeout);
    	}
    	else if(id in channel && channel[id]._myAddress == e.returnValues.challenger) {
     		var myBalance = e.returnValues.bal1;
    		var otherBalance = e.returnValues.bal2;
    		var versionNumber = e.returnValues.vn;
    		var closeTimeout = e.returnValues.cls_timeout;

    		sentClsRequest[id] = new ClosingRequest(id, myBalance, otherBalance, versionNumber, closeTimeout);		
    	}
    }
    else if(e.event == 'EventCloseChannelRespond') {
    	const id = e.returnValues.id;

    	if(id in channel) {
    		var myBalance = '';
    		var otherBalance = '';

    		var myAddress = channel[id]._myAddress;
    		var myDeposit = channel[id]._myDeposit;

    		if(myAddress == e.returnValues.owner1) {
    			myBalance = e.returnValues.owner1_bal;
    			otherBalance = e.returnValues.owner2_bal;
    		}
    		else {
    			myBalance = e.returnValues.owner2_bal;
    			otherBalance = e.returnValues.owner1_bal;    			
    		}

    		var otherAddress = channel[id]._otherAddress;
    		var otherDeposit = channel[id]._otherDeposit;

    		closedChannel[id] = new Channel(id, myAddress, myDeposit, otherAddress, otherDeposit, 0);
    		closedChannel[id]._myBalance = myBalance;
    		closedChannel[id]._otherBalance = otherBalance;

    		if(id in receivedClsRequest) delete receivedClsRequest[id];
    		if(id in sentClsRequest) delete sentClsRequest[id];

    		delete channel[id];
    	}
    }
});


/* grpc my server construction */
function pay(call, callback) {
	const id = call.request.ch_id;
	const amount = call.request.amount;

	channel[id]._myBalance += amount;
	channel[id]._otherBalance -= amount;
	channel[id]._versionNumber += 1;

	callback(null, {result: 'pay was performed successfully'});
}

function requestLock(call, callback) {
	var id = call.request.ch_id;

	var myBalance = channel[id]._myBalance.toString();
	var otherBalance = channel[id]._otherBalance.toString();
	var versionNumber = channel[id]._versionNumber.toString();

	var message = id + myBalance;
	signed = web3.eth.accounts.sign(message, account[channel[id]._myAddress]._privateKey);

	channel[id]._status = 'LOCKED';

	server.sendChannelState({
		id:id,
		balance:myBalance,
		message:message,
		signature:signed.signature
	}, function(err, response) {
		console.log(response.result);
	});

	callback(null, {result: 'request_lock was performed successfully'});
}

function requestSignature(call, callback) {
	var id = call.request.ch_id;
	var amount = call.request.amount;

	var message = id + amount.toString();
	signed = web3.eth.accounts.sign(message, account[channel[id]._myAddress]._privateKey);

	channel[id]._status = 'SIGNED';
	payment = {id:id, amount:amount};

	server.sendSignature({
		message:message,
		signature:signed.signature
	}, function(err, response) {
		console.log(response.result);
	});

	callback(null, {result: 'request_signature was performed successfully'});
}

function sendConfirm(call, callback) {
	var channelID = payment.id;
	var amount = payment.amount;

	channel[channelID]._myBalance -= amount;
	channel[channelID]._otherBalance += amount;
	channel[channelID]._versionNumber += 1;

	//channel[channelID]._status = 'CONFIRMED';

	var client = new clientProto.Client('localhost:' + channel[channelID]._otherPort,
		                                grpc.credentials.createInsecure());
	client.pay({ch_id: channelID, amount: amount}, function(err, response) {
		channel[channelID]._status = 'READY';
		console.log(response.result);
	});

	callback(null, {result: 'send_confirm was performed successfully'});
}


myServer.addService(clientProto.Client.service, {
	pay:pay,
	requestLock:requestLock,
	requestSignature:requestSignature,
	sendConfirm:sendConfirm
});
myServer.bind('0.0.0.0:' + process.argv[3], grpc.ServerCredentials.createInsecure());
myServer.start();


/* routing task construction */
function getReceivedOpenRequest() {
	var rcvdRequests = new Array();
	var d = new Date(0);

	Object.keys(receivedOpnRequest).map(function(key, index) {
		d.setUTCSeconds(receivedOpnRequest[key]._openTimeout);
		rcvdRequests.push({
			channelID:receivedOpnRequest[key]._channelID,
			myAddress:receivedOpnRequest[key]._myAddress,
			otherAddress:receivedOpnRequest[key]._otherAddress,
			otherDeposit:receivedOpnRequest[key]._otherDeposit,
			openTimeout:d,
			closeTimeInterval:receivedOpnRequest[key]._closeTimeInterval
		});
	});

	return rcvdRequests;
}

function getSentOpenRequest() {
	var sentRequests = new Array();
	var d = new Date(0);

	Object.keys(sentOpnRequest).map(function(key, index) {
		d.setUTCSeconds(sentOpnRequest[key]._openTimeout);
		sentRequests.push({
			channelID:sentOpnRequest[key]._channelID,
			myAddress:sentOpnRequest[key]._myAddress,
			myDeposit:sentOpnRequest[key]._myDeposit,
			otherAddress:sentOpnRequest[key]._otherAddress,
			openTimeout:d,
			closeTimeInterval:sentOpnRequest[key]._closeTimeInterval
		});
	});

	return sentRequests;
}

function getReceivedCloseRequest() {
	var rcvdRequests = new Array();
	var d = new Date(0);

	Object.keys(receivedClsRequest).map(function(key, index) {
		d.setUTCSeconds(receivedClsRequest[key]._closeTimeout);
		rcvdRequests.push({
			channelID:receivedClsRequest[key]._channelID,
			myBalance:receivedClsRequest[key]._myBalance,
			otherBalance:receivedClsRequest[key]._chalBalance,
			versionNumber:receivedClsRequest[key]._versionNumber,
			closeTimeout:d,
		});
	});

	return rcvdRequests;
}

function getSentCloseRequest() {
	var sentRequests = new Array();
	var d = new Date(0);

	Object.keys(sentClsRequest).map(function(key, index) {
		d.setUTCSeconds(sentClsRequest[key]._closeTimeout);
		sentRequests.push({
			channelID:sentClsRequest[key]._channelID,
			myBalance:sentClsRequest[key]._chalBalance,
			otherBalance:sentClsRequest[key]._myBalance,
			versionNumber:sentClsRequest[key]._versionNumber,
			closeTimeout:d,
		});
	});

	return sentRequests;
}


exports.showMyChannels = (req, res, next) => {
	var channels = new Array();

	Object.keys(channel).map(function(key, index) {
		channels.push({
			channelID:channel[key]._channelID,
			myAddress:channel[key]._myAddress,
			myDeposit:channel[key]._myDeposit,
			myBalance:channel[key]._myBalance,
			otherAddress:channel[key]._otherAddress,
			otherDeposit:channel[key]._otherDeposit,
			otherBalance:channel[key]._otherBalance,
			status:channel[key]._status,
			versionNumber:channel[key]._versionNumber,
			closeTimeInterval:channel[key]._closeTimeInterval
		});
	});
	res.render('channel', {channels:channels});
};

exports.requestOpenPage = (req, res, next) => {
	var addresses = new Array();
	Object.keys(account).map(function(key, index) {
		addresses.push(account[key]._publicAddress);
	});
	res.render('request_open', {addresses:addresses});
};

exports.requestOpen = (req, res, next) => {
	var channelName = req.body.ch_name;
	var myAddress = req.body.my_addr;
	var otherAddress = req.body.other_addr;
	var deposit = req.body.deposit;
	var opnDelta = Number(req.body.opn_delta);
	var clsDelta = Number(req.body.cls_delta);

	// send a transaction calling open_channel to the blockchain network
	var value1 = web3.utils.keccak256(channelName);
	var value2 = web3.utils.toChecksumAddress(otherAddress);
	var value3 = opnDelta;
	var value4 = clsDelta;

	var gasPrice = web3.eth.gasPrice;
	web3.eth.getTransactionCount(web3.utils.toChecksumAddress(myAddress), function(err, nonce) {
		var encodedData = InstaPayContract.methods.open_channel(value1, value2, value3, value4).encodeABI();
		var tx = {
			to:contractAddress,
			gasPrice:gasPrice,
			gas:2000000,
			nonce:nonce,
			value:web3.utils.toWei(deposit, 'ether'),
			data:encodedData
		};
		web3.eth.accounts.signTransaction(tx, account[myAddress]._privateKey, function(err, signed) {
			if(!err)
				web3.eth.sendSignedTransaction(signed.rawTransaction); //.on('receipt', console.log);
			else
				console.error(err);

			var addresses = new Array();
			Object.keys(account).map(function(key, index) {
				addresses.push(account[key]._publicAddress);
			});
			res.render('request_open', {addresses:addresses});
		});
	});
};

exports.requestPendingOpenPage = (req, res, next) => {
	var rcvdRequests = new Array();
	var sentRequests = new Array();

	rcvdRequests = getReceivedOpenRequest();
	sentRequests = getSentOpenRequest();

	res.render('pending_opn_req', {rcvdRequests:rcvdRequests, sentRequests:sentRequests});
};

exports.requestOpenConfirm = (req, res, next) => {
	var channelID = req.body.ch_id;
	var myDeposit = req.body.my_deposit;
	var myAddress = receivedOpnRequest[channelID]._myAddress;

	receivedOpnRequest[channelID]._myDeposit = myDeposit;

	// send a transaction calling open_channel_respond to the blockchain network
	var value1 = channelID;

	var gasPrice = web3.eth.gasPrice;
	web3.eth.getTransactionCount(web3.utils.toChecksumAddress(myAddress), function(err, nonce) {
		var encodedData = InstaPayContract.methods.open_channel_respond(value1).encodeABI();
		var tx = {
			to:contractAddress,
			gasPrice:gasPrice,
			gas:2000000,
			nonce:nonce,
			value:web3.utils.toWei(myDeposit, 'ether'),
			data:encodedData
		};
		web3.eth.accounts.signTransaction(tx, account[myAddress]._privateKey, function(err, signed) {
			if(!err)
				web3.eth.sendSignedTransaction(signed.rawTransaction); //.on('receipt', console.log);
			else
				console.error(err);

			rcvdRequests = getReceivedOpenRequest();
			sentRequests = getSentOpenRequest();

			res.render('pending_opn_req', {rcvdRequests:rcvdRequests, sentRequests:sentRequests});
		});
	});
};

exports.requestPayPage = (req, res, next) => {
	var ids = new Array();
	Object.keys(channel).map(function(key, index) {
		ids.push(channel[key]._channelID);
	});
	res.render('request_pay', {ids:ids});
};

exports.requestPay = (req, res, next) => {
	var channelID = req.body.ch_id;
	var amount = Number(req.body.amount);

	channel[channelID]._myBalance -= amount;
	channel[channelID]._otherBalance += amount;
	channel[channelID]._versionNumber += 1;

	var client = new clientProto.Client('localhost:' + channel[channelID]._otherPort,
		                                grpc.credentials.createInsecure());
	client.pay({ch_id: channelID, amount: amount}, function(err, response) {
		console.log(response.result);
	});

	var ids = new Array();
	Object.keys(channel).map(function(key, index) {
		ids.push(channel[key]._channelID);
	});

	res.render('request_pay', {ids:ids});
};

exports.requestPayAddr = (req, res, next) => {
	var channelID = req.body.ch_id;
	var otherAddress = req.body.addr;
	var amount = Number(req.body.amount);
	var myAddress = channel[channelID]._myAddress;

	server.requestPayment({
		sender_addr:channel[channelID]._myAddress,
		receiver_addr:otherAddress,
		amount:amount
	}, function(err, response) {
		console.log(response);
	});
};

exports.requestPayInvoice = (req, res, next) => {
	var channelID = req.body.ch_id;
	var invoice = req.body.invoice;
	var myAddress = channel[channelID]._myAddress;

	var decoded = decode(invoice);
	var payee = decoded.payeeNodeKey;
	var amount = parseFloat(decoded.satoshis * 0.00001).toPrecision(12);

	console.log('INVOIE amount: ' + amount);
	console.log('TYPE: ' + typeof amount);

	server.requestPayment({
		sender_addr:myAddress,
		receiver_addr:payee,
		amount:amount
	}, function(err, response) {
		console.log(response);
	});
};

exports.requestCloseConfirm = (req, res, next) => {
	var channelID = req.body.ch_id;
	var myBalance = channel[channelID]._myBalance;
	var otherBalance = channel[channelID]._otherBalance;
	var versionNumber = channel[channelID]._versionNumber;
	var myAddress = channel[channelID]._myAddress;

	// send a transaction calling open_channel_respond to the blockchain network
	var value1 = channelID;
	var value2 = Math.floor(myBalance);
	var value3 = Math.floor(otherBalance);
	var value4 = versionNumber;

	var gasPrice = web3.eth.gasPrice;
	web3.eth.getTransactionCount(web3.utils.toChecksumAddress(myAddress), function(err, nonce) {
		var encodedData = InstaPayContract.methods.close_channel(value1, value2, value3, value4).encodeABI();
		var tx = {
			to:contractAddress,
			gasPrice:gasPrice,
			gas:2000000,
			nonce:nonce,
			data:encodedData
		};
		web3.eth.accounts.signTransaction(tx, account[myAddress]._privateKey, function(err, signed) {
			if(!err) {
				web3.eth.sendSignedTransaction(signed.rawTransaction); //.on('receipt', console.log);
			}
			else
				console.error(err);
		});
	});
};

exports.requestPendingClosePage = (req, res, next) => {
	var rcvdRequests = '';
	var sentRequests = '';

	rcvdRequests = getReceivedCloseRequest();
	sentRequests = getSentCloseRequest();

	res.render('pending_cls_req', {rcvdRequests:rcvdRequests, sentRequests:sentRequests});
};

exports.requestChalConfirm = (req, res, next) => {
	var channelID = req.body.ch_id;

	var myBalance = channel[channelID]._myBalance;
	var otherBalance = channel[channelID]._otherBalance;
	var versionNumber = channel[channelID]._versionNumber;
	var myAddress = channel[channelID]._myAddress;

	// send a transaction calling open_channel_respond to the blockchain network
	var value1 = channelID;
	var value2 = Math.floor(myBalance);
	var value3 = Math.floor(otherBalance);
	var value4 = versionNumber;

	var gasPrice = web3.eth.gasPrice;
	web3.eth.getTransactionCount(web3.utils.toChecksumAddress(myAddress), function(err, nonce) {
		var encodedData = InstaPayContract.methods.close_channel_respond(value1, value2, value3, value4).encodeABI();
		var tx = {
			to:contractAddress,
			gasPrice:gasPrice,
			gas:2000000,
			nonce:nonce,
			data:encodedData
		};
		web3.eth.accounts.signTransaction(tx, account[myAddress]._privateKey, function(err, signed) {
			if(!err) {
				web3.eth.sendSignedTransaction(signed.rawTransaction); //.on('receipt', console.log);
			}
			else
				console.error(err);
		});
	});	
};

exports.requestClosedChannel = (req, res, next) => {
	var closedChannels = new Array();

	Object.keys(closedChannel).map(function(key, index) {
		closedChannels.push({
			channelID:closedChannel[key]._channelID,
			myAddress:closedChannel[key]._myAddress,
			myDeposit:closedChannel[key]._myDeposit,
			myBalance:closedChannel[key]._myBalance,
			otherAddress:closedChannel[key]._otherAddress,
			otherDeposit:closedChannel[key]._otherDeposit,
			otherBalance:closedChannel[key]._otherBalance
		});
	});
	res.render('closed_channel', {closedChannels:closedChannels});
};
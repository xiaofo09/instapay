const async = require('async');
var grpc = require('grpc');

const web3 = require('../config').web3;
const InstaPayContract = require('../config').contractInstance;
const contractAddress = require('../config').contractAddress;
var event = require('../config').event;
var server = require('../config').server;
var serverProto = require('../config').serverProto;
var clientProto = require('../config').clientProto;

var models = require('../models');
const Client = models.Client;
const Channel = models.Channel;
const Payment = models.Payment;


/* event construction */
event.on('data', e => {
    if(e.event == 'EventOpenChannelRespond') {
    	const id = e.returnValues.id;
    	channel[id] = new Channel(
    		id,
    		e.returnValues.alice,
    		e.returnValues.bob,
    		web3.utils.fromWei(e.returnValues.alice_dep._hex, 'ether'),
    		web3.utils.fromWei(e.returnValues.bob_dep._hex, 'ether')
    	);
    }
});


var client = {}
client['0xD03A2CC08755eC7D75887f0997195654b928893e'] = new Client('0xD03A2CC08755eC7D75887f0997195654b928893e', '50001');
client['0x0b4161ad4f49781a821C308D672E6c669139843C'] = new Client('0x0b4161ad4f49781a821C308D672E6c669139843C', '50002');
client['0x78902c58006916201F65f52f7834e467877f0500'] = new Client('0x78902c58006916201F65f52f7834e467877f0500', '50003');

var channel = {}
var payment = '';


function eqSet(as, bs) {
    if (as.size !== bs.size) return false;
    for (var a of as) if (!bs.has(a)) return false;
    return true;
}


/* core construction */
function searchPath(senderAddress, receiverAddress, amount) {
	var associatedAddrs = new Set();
	var pk = 0;
	var paymentData = {};
	var channelID1 = '';
	var channelID2 = '';

	/* hardcoded payment data */
	Object.keys(channel).map(function(key, index) {
		if(channel[key]._aliceAddress == '0xD03A2CC08755eC7D75887f0997195654b928893e')
			channelID1 = channel[key]._channelID;
		else if(channel[key]._aliceAddress == '0x0b4161ad4f49781a821C308D672E6c669139843C')
			channelID2 = channel[key]._channelID;
	});

	associatedAddrs.add('0xD03A2CC08755eC7D75887f0997195654b928893e');
	associatedAddrs.add('0x0b4161ad4f49781a821C308D672E6c669139843C');

	paymentData['0xD03A2CC08755eC7D75887f0997195654b928893e'] = [
		{
			channelID:channelID1,
			amount:amount
		}
	];
	paymentData['0x0b4161ad4f49781a821C308D672E6c669139843C'] = [
		{
			channelID:channelID2,
			amount:amount
		}
	];

	payment = new Payment(
		senderAddress,
		receiverAddress,
		amount,
		associatedAddrs,
		paymentData,
		0 	// date
	);

	return {a:associatedAddrs, pk:pk, d:paymentData};
}


/* grpc my server construction */
function getClientInfo(call, callback) {
	const address = call.request.address;
	callback(null, {port:client[address]._port});
}

function requestPayment(call, callback) {
	const senderAddress = call.request.sender_addr;
	const receiverAddress = call.request.receiver_addr;
	const amount = call.request.amount;

	var p = searchPath(senderAddress, receiverAddress, amount);
	var ids = '';

	Object.keys(p.d).map(function(key, index) {
		var clientConnect = new clientProto.Client('localhost:' + client[key]._port,
			                                grpc.credentials.createInsecure());

		console.log(p.d[key][0].channelID);

		clientConnect.requestLock({ch_id:p.d[key][0].channelID}, function(err, response) {
			console.log(response.result);
		});
	});

	callback(null, {result:'success'});
}

function sendChannelState(call, callback) {
	var id = call.request.id;
	var balance = call.request.balance;
	var message = call.request.message;
	var signature = call.request.signature;

	var sender = web3.eth.accounts.recover(message, signature);

	/* TODO: check balance */

	if(payment._associatedAddrs.has(sender)) {
		payment._lockAgreed.add(sender);
		payment._lockSignature[sender] = {
			channelID:id,
			balance:balance,
			signature:signature
		};
	}

	if(eqSet(payment._associatedAddrs, payment._lockAgreed)) {
		Object.keys(payment._paymentData).map(function(key, index) {
			var clientConnect = new clientProto.Client('localhost:' + client[key]._port,
				                                grpc.credentials.createInsecure());
			clientConnect.requestSignature({
				ch_id:payment._paymentData[key][0].channelID,
				amount:payment._paymentData[key][0].amount
			}, function(err, response) {
				console.log(response.result);
			});
		});
	}

	callback(null, {result:'sendChannelState was performed successfully'});
}

function sendSignature(call, callback) {
	var message = call.request.message;
	var signature = call.request.signature;

	var sender = web3.eth.accounts.recover(message, signature);

	if(payment._associatedAddrs.has(sender)) {
		payment._signAgreed.add(sender);
		payment._paymentSignature[sender] = {
			signature:signature
		};
	}

	if(eqSet(payment._associatedAddrs, payment._signAgreed)) {
		Object.keys(payment._paymentData).map(function(key, index) {
			var clientConnect = new clientProto.Client('localhost:' + client[key]._port,
				                                grpc.credentials.createInsecure());
			clientConnect.sendConfirm({
				result:'confirmed'
			}, function(err, response) {
				console.log(response.result);
			});
		});
	}

	callback(null, {result:'sendSignature was performed successfully'});
}


server.addService(serverProto.Server.service, {
	getClientInfo:getClientInfo,
	requestPayment:requestPayment,
	sendChannelState:sendChannelState,
	sendSignature:sendSignature
});
server.bind('0.0.0.0:' + process.argv[3], grpc.ServerCredentials.createInsecure());
server.start();


/* routing task construction */
exports.showClientInfo = (req, res, next) => {
	var clients = new Array();
	payment = 'al';
	Object.keys(client).map(function(key, index) {
		clients.push({
			publicAddress:client[key]._publicAddress,
			port:client[key]._port
		});
	});

	res.render('client', {clients:clients});
};

exports.showClientChannel = (req, res, next) => {
	var channels = new Array();
	Object.keys(channel).map(function(key, index) {
		channels.push({
			channelID:channel[key]._channelID,
			aliceAddress:channel[key]._aliceAddress,
			bobAddress:channel[key]._bobAddress,
			aliceDeposit:channel[key]._aliceDeposit,
			bobDeposit:channel[key]._bobDeposit
		});
	});

	res.render('client_channel', {channels:channels});	
};

exports.showPaymentHist = (req, res, next) => {
	var senderAddress = payment._senderAddress;
	var receiverAddress = payment._receiverAddress;
	var amount = payment._amount;
	var paymentSignature = payment._paymentSignature;
	var signatures = new Array();

	Object.keys(paymentSignature).map(function(key, index) {
		signatures.push(paymentSignature[key].signature);
	});

	res.render('payment', {
		senderAddress:senderAddress,
		receiverAddress:receiverAddress,
		amount:amount,
		signatures:signatures
	});
};

exports.payment = payment;
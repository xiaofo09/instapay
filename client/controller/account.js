const async = require('async');

const models = require('../models');
const web3 = require('../config').web3;

const Account = models.Account;


var account = {};
if(process.argv[2] == '3001')
	account['0xD03A2CC08755eC7D75887f0997195654b928893e'] = new Account('0xD03A2CC08755eC7D75887f0997195654b928893e', '0xe113ff405699b7779fbe278ee237f2988b1e6769d586d8803860d49f28359fbd');
if(process.argv[2] == '3002')
	account['0x0b4161ad4f49781a821C308D672E6c669139843C'] = new Account('0x0b4161ad4f49781a821C308D672E6c669139843C', '0x240af81838ad22e8baa5c6223c7c7e112b091ba50e6fb396c0dc2b84cf034169');
if(process.argv[2] == '3003')
	account['0x78902c58006916201F65f52f7834e467877f0500'] = new Account('0x78902c58006916201F65f52f7834e467877f0500', '0x3038465f2b9be0048caa9f33e25b5dc50252f04c078aaddfbea74f26cdeb9f3c');


exports.showMyAccounts = (req, res, next) => {
	var getBalanceCalls = new Array();
	Object.keys(account).map(function(key, index) {
		getBalanceCalls.push(
			function(callback) {
				web3.eth.getBalance(account[key]._publicAddress, function(err, res) {
					callback(null, {'address':account[key]._publicAddress, 'balance':web3.utils.fromWei(res, 'ether')});
				});
			}
		);
	});

	async.series(getBalanceCalls, function(err, results) {
		res.render('account', {my_accounts : results});
	});
};

exports.account = account;
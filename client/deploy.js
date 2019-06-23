const fs = require('fs');
const Web3 = require('web3');
const solc = require('solc');
const tx = require('ethereumjs-tx');

const web3 = new Web3(new Web3.providers.WebsocketProvider('ws://localhost:8881'));
const source = fs.readFileSync('../contracts/InstaPay.sol', 'utf8');
const compiledContract = solc.compile(source);

const address = '0x15ff97b6603c940aa66261fd1cfb9d395f57bdb9';


function sleep(ms) {
  return new Promise(resolve=>setTimeout(resolve, ms));
}


for (let contractName in compiledContract.contracts) {
    var bytecode = compiledContract.contracts[contractName].bytecode;
    var abi = JSON.parse(compiledContract.contracts[contractName].interface);
}

web3.eth.estimateGas({data: '0x' + bytecode}, function(err, res) {
	let gasEstimate = res;
	web3.eth.personal.unlockAccount(address, '1111', 600, function(err, res) {
		let myContract = web3.eth.Contract(abi);

		myContract.options.data = '0x' + bytecode;
		myContract.deploy({
		})
		.send({
			from: address,
			gas: gasEstimate + 50000,
			gasPrice: '30000000000000'
		})
		.then((newContractInstance) => {
		    console.log(newContractInstance.options.address)
		});
	});
});